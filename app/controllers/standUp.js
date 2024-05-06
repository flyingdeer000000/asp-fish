'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');
const uuid = require('uuid/v1');
let util = require('util');

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto.quitGameAsync = cort(function* (player, accessToken, fireServerId, betSetting) {
    try {
        if (!player.tableId) return {error: C.TABLE_NOT_FOUND};
        let ret = yield this.checkAndLeaveTable(player, false, accessToken, fireServerId, betSetting);
        if (!ret.error) {
            this.app.controllers.fishHunterPlayer.pushAsync(player._id, consts.route.client.game.END, {}, false);
        } else {
            logger.error('[standUp][quitGameAsync] checkAndLeaveTable end, but playerId: %s, fail: ', player._id, ret);
        }
        return ret;
    } catch (err) {
        logger.error('[standUp][quitGameAsync] player: %s, err : ', JSON.stringify(player), err);
    }
});

proto.checkAndLeaveTable = cort(function* (player, offline, accessToken, fireServerId, betSetting) {
    if (!player.tableId) return {error: C.TABLE_NOT_FOUND};
    let self = this;
    let app = this.app;
    let playerId = player._id;
    player['offline'] = offline;

    return P.resolve(0)
        .then(() => {
            logger.info('[standUp][checkAndLeaveTable] step 0 : playerId: %s, offline: %s, player: ', playerId, offline, player);
            if (player.gameState != consts.GameState.PLAYING && player.gameState != consts.GameState.READY) {
                // 狀態若為 ready: 可能入桌失敗
                logger.warn('[standUp][checkAndLeaveTable] error 0, player gameState not playing || ready : ', player);
                return {error: null};
            }
            return app.memdb.goose.transactionAsync(function () {
                return self.app.controllers.fishHunterPlayer.internalUpdateAsync(playerId, {
                    gameState: consts.GameState.LEAVING
                }).then(() => {
                    return {error: null};
                })
            }, app.getServerId())
                .catch((err) => {
                    logger.error('[standUp][checkAndLeaveTable][internalUpdateAsync] playerId: %s, player: %s, err: ', playerId, JSON.stringify(player), JSON.stringify(err));
                    return {error: C.ERROR};
                });
        })
        .then((data) => {
            logger.info('[standUp][checkAndLeaveTable] step 1 : playerId: %s, gameState: %s', playerId, player.gameState);
            if (!!data.error) {
                logger.error('[standUp][checkAndLeaveTable] error 1, playerId: %s, fail: ', playerId, JSON.stringify(data));
                return data;
            }
            if (player.gameState != consts.GameState.PLAYING) return {error: null};
            //游戏中不离开桌子
            return app.memdb.goose.transactionAsync(function () {
                logger.info('[standUp][checkAndLeaveTable] step 1-1 : playerId: %s', playerId);
                return self.doAreaSummaryAsync(player, player.tableId, player.connectorId, fireServerId, betSetting);
            }, app.getServerId())
                .catch((err) => {
                    logger.error('[standUp][checkAndLeaveTable][doAreaSummaryAsync] playerId: %s, player: %s, err: ', playerId, JSON.stringify(player), JSON.stringify(err));
                    return {error: C.ERROR};
                });
        })
        .then((result) => {
            logger.info('[standUp][checkAndLeaveTable] step 2 : playerId: %s, result: %s', playerId, JSON.stringify(result));
            let ret = {
                error: null,
                data: player.toClientData(),
            }
            return app.memdb.goose.transactionAsync(cort(function* () {
                if (player.gameState == consts.GameState.PLAYING) {
                    logger.info('[standUp][checkAndLeaveTable] step 2-1 : playerId: %s, result: %s', playerId, JSON.stringify(player), JSON.stringify(result));
                    player = yield self.gameSettlementAsync(playerId, player.tableId, player.areaId, result);
                    if (offline) {
                        logger.info('[standUp][checkAndLeaveTable] step 2-1-1 : playerId: %s, result: %s', playerId, JSON.stringify(player), JSON.stringify(result));
                        yield self.app.controllers.fishHunterPlayer.offlineAsync(playerId); // 清玩家身上的 connectorId & gameServerId
                    } else {
                        logger.info('[standUp][checkAndLeaveTable] step 2-1-2 : playerId: %s, result: %s', playerId, JSON.stringify(player), JSON.stringify(result));
                        return ret;
                    }
                } else if (player.gameState == consts.GameState.READY) {
                    logger.warn('[standUp][checkAndLeaveTable] step 2-2 : playerId: %s, result: %s', playerId, JSON.stringify(player), JSON.stringify(result));
                    //准备状态离开桌子
                    yield self.standUpAsync(player);
                }
                // 給離桌程序判斷是否需要重新取得玩家資訊
                player['checkAndLeaveTable'] = true;
                logger.info('[standUp][checkAndLeaveTable] step 2-3 : playerId: %s, result: %s', playerId, JSON.stringify(player), JSON.stringify(result));
                let leaveTable = yield self.leaveTableAsync(player, betSetting.usedCid);
                if (!leaveTable.error) {
                    ret.error = leaveTable.error;
                    ret.data = leaveTable.data;
                }
                logger.info('[standUp][checkAndLeaveTable] step 2 done. playerId: %s, leaveTable: %s, ret: %s', playerId, JSON.stringify(leaveTable), JSON.stringify(ret));
                return ret;
            }), app.getServerId())
                .catch(err => {
                    logger.error('[standUp][checkAndLeaveTable][gameSettlementAsync] playerId: %s, player: %s, err: ', playerId, JSON.stringify(player), err);
                    return {error: C.ERROR};
                })
        })
        .catch((err) => {
            logger.error('[standUp][checkAndLeaveTable] playerId: %s, player: %s, err: ', playerId, JSON.stringify(player), err);
            return {error: C.ERROR};
        })
});

proto.doAreaSummaryAsync = cort(function* (player, tableId, connectorId, fireServerId, betSetting) {
    try {
        let self = this;
        let playerId = player._id;
        let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
        let areaPlayers = yield modelAreaPlayers.findReadOnlyAsync({areaId: player.areaId});
        let aps = [];
        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
            logger.error(`[standUp][doAreaSummaryAsync] no betSetting! playerId: ${playerId}`);
            return {error: C.ERROR, msg: `no bet setting! playerId: ${playerId}, tableId: ${tableId}`};
        }
        for (let i = 0; i < areaPlayers.length; i++) {
            aps.push(areaPlayers[i].toClientData(betSetting));
        }

        // 清除魚場 players 正在離桌的此位玩家
        yield self.clearAreaPlayer(player.areaId, playerId);

        let reData = { // 給前端的 update.wallet
            creditAmount: 0, // 回傳前端lobby顯示餘額
            playerId: playerId,
            amount: 0,
        };
        let tokensDao = self.app.controllers.daoMgr.getGameTokenDao();
        logger.info('leave connector playerId: %s, ', player._id, util.inspect({
            connectorId,
            playerId,
            fireServerId,
            backendServerId: player.backendServerId
        }));
        let backendRpc = self.app.rpc.fishHunterBackend.areaRemote;
        let res_stopFire;
        // 後扣型錢包
        if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) {
            let tokens = yield tokensDao.findOneAsync(playerId, player.gameId, true);
            reData['creditAmount'] = tokens.balance;
            self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_WALLET, reData, false);
            let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'doAreaSummaryAsync_byDelayWallet');
            // 玩家是登出或重整 // 不處理 stopFire 在排程(singleWalletBalanceSync)處理
            if (!sessionId) return {error: null, data: {areaPlayers: aps}};
            else logger.info(`[standUp][doAreaSummaryAsync] playerId: ${playerId}, sessionId: ${sessionId}`);
            // 玩家是回到遊戲大廳 // 處理 stopFire + 刪除 areaPlayer
            if (!!fireServerId) {
                res_stopFire = yield P.promisify(backendRpc.stopFire.toServer, backendRpc.stopFire)(fireServerId, player, player.gameId, player.areaId, self.app.getServerId(), betSetting);
            } else {
                res_stopFire = yield P.promisify(backendRpc.stopFire.toServer, backendRpc.stopFire)(player.backendServerId, player, player.gameId, player.areaId, self.app.getServerId(), betSetting);
            }
            let _areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: player.areaId, playerId: playerId});
            if (_areaPlayer)
                yield _areaPlayer.removeAsync();
            return {error: null, data: {areaPlayers: aps}};
        }
        // 其他類型錢包

        // 提前檢查 areaPlayer 是否存在
        let readOnly_areaPlayer = yield modelAreaPlayers.findOneReadOnlyAsync({
            areaId: player.areaId,
            playerId: playerId
        });
        if (!readOnly_areaPlayer) {
            logger.warn('[standUp][doAreaSummaryAsync] playerId: %s, areaId: %s, Not find read only areaPlayer: ', playerId, player.areaId, readOnly_areaPlayer);
            return {error: null, data: {areaPlayers: aps}};
        }

        yield tokensDao.settlePrepare(playerId, player.gameId); // 設定錢包結帳中
        // 检查未消耗子弹，并退款
        // ============ Stop Fire ============
        if (!!fireServerId) {
            res_stopFire = yield P.promisify(backendRpc.stopFire.toServer, backendRpc.stopFire)(fireServerId, player, player.gameId, player.areaId, self.app.getServerId(), betSetting);
        } else {
            res_stopFire = yield P.promisify(backendRpc.stopFire.toServer, backendRpc.stopFire)(player.backendServerId, player, player.gameId, player.areaId, self.app.getServerId(), betSetting);
        }
        // ===================================

        let beforeBalance = 0;
        let afterBalance = 0;

        let currentTs = Date.now();
        let tokens = yield tokensDao.findOneAsync(playerId, player.gameId, true);
        let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: player.areaId, playerId: playerId});
        if (!areaPlayer) {
            // 找不到 areaPlayer 時，檢查 mongo 母單是否已寫入
            if (tokens.wagerId !== '') {
                let areaPlayerHistoryDao = self.app.controllers.daoMgr.getAreaPlayerHistoryDao();
                let mainData = yield areaPlayerHistoryDao.findByIdAsync(tokens.wagerId, true);
                // 已有寫入母單
                if (mainData) {
                    logger.info(`[standUp][doAreaSummaryAsync] 已有寫入母單 playerId: ${playerId},  mainData: ${JSON.stringify(mainData)}`,);
                    return {error: null, data: {areaPlayers: aps}};
                }
            }
            this.app.controllers.debug.info('error', 'doAreaSummaryAsync', {
                player: player,
                areaPlayer: areaPlayer,
                fireServerId: fireServerId,
                reason: '離桌找不到 areaPlayer'
            });
            return {error: null, data: {areaPlayers: aps}};
        }

        this.app.controllers.debug.info('info', 'doAreaSummaryAsync', {
            playerId: playerId,
            tableId: tableId,
            connectorId: connectorId,
            areaPlayer: areaPlayer,
            tokens: tokens,
        });

        let areaPlayerData = areaPlayer.toObject();
        // 是否儲存母單
        let saveHistory = true;

        // 母單編號:
        if (!tokens) {
            areaPlayerData._id = utils.getWId(playerId, player.gameId);
        } else {
            areaPlayerData._id = tokens.wagerId == '' ? utils.getWId(playerId, player.gameId) : tokens.wagerId;
            if (tokens.wagerId == '') {
                logger.error(`[standUp][doAreaSummaryAsync][手動補單] playerId: ${playerId}, roundId: ${player.roundID}, areaPlayer: ${JSON.stringify(areaPlayer)}, tokens: ${JSON.stringify(tokens)}`);
                // 特殊情況，不儲存資料錯誤的母單，暫由人工補單並且查詢原因 // 目前已由登入時，擋住不重複執行登入流程，防止 session 殘留導致執行兩次離桌流程
                saveHistory = false;
            }
        }
        //產生寫入時間ts用來回傳API roundId及日後辨別用
        areaPlayerData.finishTime = utils.timeConvert(currentTs, true);
        let denom = 0;

        // new 一個 mongo 母單
        let mongoWagers = new self.app.models.FishHunterAreaPlayersHistory(areaPlayerData);
        mongoWagers.createTime = utils.timeConvert(currentTs, true); // 寫入離場時間
        mongoWagers.roundID = player.roundID;
        mongoWagers.loginIp = areaPlayerData.loginIp;

        if (!!tokens) {
            beforeBalance = tokens.oneAreaExchange;
            afterBalance = tokens.balance;
            denom = tokens.ratio;

            mongoWagers.gain = tokens.gain;
            mongoWagers.cost = tokens.cost;
            mongoWagers.gameTypeId = tokens.gameTypeId;

            if (denom !== 1) {
                logger.error('[standUp][doAreaSummaryAsync] playerId: %s, denom: ', player._id, denom);
                denom = 1; // 先設法改回 1
            }

            let featchBalanceRes = null;
            switch (player.isSingleWallet) {
                case consts.walletType.multipleWallet: // 多錢包
                    if (!player.offline) {
                        // 玩家回到大廳才需更新餘額，若是登出則不須 callFetchBalance
                        featchBalanceRes = yield self.app.controllers.fishHunterPlayer.callFetchBalance(player);
                        if (!featchBalanceRes || featchBalanceRes.code !== C.OK) {
                            featchBalanceRes = null; // callFetchBalance 失敗
                        }
                    }
                    // 回大廳時右下角顯示金額: token.amount + MySQL.Quota(身上的+平台的)
                    reData['creditAmount'] = (player.demo !== consts.demoType.demo) ? utils.number.add(tokens.balance, !featchBalanceRes ? 0 : featchBalanceRes.amount) : utils.number.add(tokens.balance, tokens.quota);
                    reData['amount'] = tokens.tokenAmount;
                    break;
                case consts.walletType.singleWallet: // 單錢包
                case consts.walletType.singleBetAndWin: // 單錢包: betAndWin
                    beforeBalance = 0;
                    afterBalance = 0;
                    reData['creditAmount'] = tokens.balance;
                    break;
                default: // 假多錢包 & 假多錢包: betAndWin
                    reData['amount'] = 0;
                    reData['creditAmount'] = tokens.balance;
                    break;
            }
            // 玩家只回到大廳非登出: 傳前端更新大廳餘額
            if (!player.offline) self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_WALLET, reData, false);
        } else
            logger.error('[standUp][doAreaSummaryAsync] err: tokens: %s, playerId: %s, gameId: %s', tokens, playerId, player.gameId);

        mongoWagers.beforeBalance = beforeBalance; // 玩家帶入桌的金額
        mongoWagers.afterBalance = afterBalance;   // 玩家離桌後的金額

        // 試玩不寫帳
        if (player.demo !== consts.demoType.demo) {
            // 字串化，方便 log 看
            if (!!mongoWagers.gunInfo && mongoWagers.gunInfo.length > 0) {
                for (let i = 0; i < mongoWagers.gunInfo.length; i++) {
                    if (!!mongoWagers.gunInfo[i].getBullet && mongoWagers.gunInfo[i].getBullet.length > 0) {
                        mongoWagers.gunInfo[i].getBullet = JSON.stringify(mongoWagers.gunInfo[i].getBullet);
                    }
                    delete mongoWagers.gunInfo[i].sourceWid;
                }
            }
            logger.info(`[母單][standUp][doAreaSummaryAsync][${saveHistory}] areaPlayersHistory:`, mongoWagers);
            // 寫入mongo歷史注單
            if (saveHistory) yield mongoWagers.saveAsync();
            mongoWagers['isSingleWallet'] = player.isSingleWallet == 0 ? 0 : 1;
            // 透過api server儲存MySQL母單
            if (saveHistory) yield self.app.controllers.wagers.addWagers(player, mongoWagers);
        }
        yield areaPlayer.removeAsync();

        // 玩家只回到大廳，代表單場結束，錢包狀態設為[結帳完成] // 玩家直接登出就讓狀態為[結帳中]，一路到帳務轉出完成才設為[結帳完成]
        yield tokensDao.settleComplete(playerId, player.gameId, player.offline, false);
        return {error: null, data: {areaPlayers: aps}};
    } catch (err) {
        logger.error('[standUp][doAreaSummaryAsync] playerId: %s, err: ', player._id, err);
        return {error: C.ERROR};
    }
});

proto.doAreaSummary_forSingleDelay = async function (player, betSetting) {
    try {
        // 後扣型錢包處理結算 // server: fishHunterBackend-server
        let self = this;
        let playerId = player._id;
        await self.stopFireAsync(player, player.gameId, player.areaId, self.app.getServerId(), betSetting);
        let areaPlayerDao = self.app.controllers.daoMgr.getAreaPlayerDao();
        await areaPlayerDao.removeAsync(player.areaId, playerId, self.app.getServerId()); // 刪除 areaPlayer
        return 'done';
    } catch (err) {
        logger.error('[standUp][doAreaSummary_forSingleDelay] playerId: %s, err: ', player._id, err);
        return 'not done';
    }
};

// 遊戲結算
proto.gameSettlementAsync = cort(function* (playerId, tableId, areaId, ret) {
    try {
        let table = _.isString(tableId) ? yield this.app.controllers.table.findReadOnlyAsync(tableId) : tableId;
        let app = this.app;
        let area = yield this.checkAreaAlive(areaId, playerId);

        let leavePlayer = yield app.controllers.fishHunterPlayer.internalUpdateAsync(playerId, {
            areaId: '',
            gameState: consts.GameState.FREE
        });
        if (ret && !ret.error && area) {
            let players = [];
            players.push(leavePlayer.toClientData());

            ret.data.players = players;
            let data = ret.data;
            ret.data = {
                area: {
                    scene: area.scene
                },
            };
            let player = null;
            let one = null;
            for (let i in data.players) {
                one = data.players[i];
                player = {
                    id: one.id,
                };
                players.push(player);
            }
            ret.data.players = players;
            players = [];
            let areaPlayer = null;
            for (let i in data.areaPlayers) {
                one = data.areaPlayers[i];
                areaPlayer = {
                    playerId: one.playerId,
                    cannonLevel: one.cannonLevel,
                    cannonCost: one.cannonCost,
                    chairId: one.chairId,
                    gunEx: one.gunEx,
                };
                players.push(areaPlayer);
            }
            ret.data.areaPlayers = players;

            app.controllers.table.pushAsync(!!table ? table._id : tableId, null, consts.route.client.game.QUIT, ret.data, false);
        }
        return leavePlayer;
    } catch (err) {
        logger.error('[standUp][gameSettlementAsync] playerId: %s, err: ', playerId, err);
    }
});

//離場時檢查所有areaPlayer的人數都沒人了 =>將魚場結束
proto.checkAreaAlive = cort(function* (areaId, playerId) {
    try {
        let self = this;
        let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
        if (!!area) {
            let count = area._doc.players.length;
            // let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
            // let count = yield modelAreaPlayers.countAsync({areaId: areaId});
            if (count == 0) {
                // let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
                if (!!area) {
                    if (area.state == consts.AreaState.END) {
                    } else {
                        area.state = consts.AreaState.END;
                    }
                    logger.info('[standUp][checkAreaAlive] playerId: %s, areaId: %s, reason: area end, area: ', playerId, areaId, area);
                }
            } else {
                logger.info('[standUp][checkAreaAlive] playerId: %s, areaId: %s, reason: area still started, area: ', playerId, areaId, area);
            }
            return area;
        } else {
            logger.warn('[standUp][checkAreaAlive] playerId: %s, areaId: %s, reason: not find area cache, area: ', playerId, areaId, area);
            return null;
        }
    } catch (err) {
        logger.error('[standUp][checkAreaAlive] playerId: %s, areaId: %s, err: ', playerId, areaId, err);
        return null;
    }
});

proto.standUpAsync = cort(function* (player) {
    try {
        if (!player.tableId) {
            return {error: C.TABLE_NOT_FOUND};
        }

        if (player.gameState !== consts.GameState.READY) {
            return {error: C.PLAYER_NOT_READY}
        }

        let p = yield this.app.controllers.fishHunterPlayer.internalUpdateAsync(player._id, {gameState: consts.GameState.FREE});
        yield this.app.controllers.fishHunterGame.pushTableMsgAsync(player, player.tableId, consts.route.client.game.STAND_UP, false);

        return {error: null, data: p.toClientData()};
    } catch (err) {
        logger.error('[standUp][standUpAsync] player: %s, err: ', JSON.stringify(player), err);
    }
});

proto.leaveTableAsync = cort(function* (player, betSettingUsedCid) {
    try {
        let playerId = player._id;
        logger.info('[standUp][leaveTableAsync] player:', player);
        if (player.checkAndLeaveTable) {
            // 直接登出的玩家，需重新取得玩家資訊，確保玩家是否已處理過離桌程序，避免重複離桌而失敗
            // let player = yield this.app.controllers.fishHunterPlayer.findOneAsync(playerId);
            player = yield this.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
            logger.info('[standUp][leaveTableAsync] from checkAndLeaveTable, player info update -> player:', player);
        }

        if (!!player && !!player.tableId) {
            // 狀態若為 ready: 可能入桌失敗
            if (player.gameState != '' && player.gameState != consts.GameState.FREE && player.gameState != consts.GameState.READY) {
                return {error: C.PLAYER_NOT_FREE};
            }

            let leavePlayer = yield this.app.controllers.fishHunterPlayer.internalUpdateAsync(playerId, {tableId: ''});
            let table = yield this.app.controllers.room.quitTableAsync(player.tableId, playerId, player.connectorId, betSettingUsedCid);
            if (!table) return {error: C.ERROR};

            yield this.app.controllers.fishHunterGame.pushTableMsgAsync(player, table, consts.route.client.table.QUIT, true);
            player = leavePlayer;
            return {error: null, data: player.toClientData()};
        } else {
            return {error: C.ERROR};
        }
    } catch (err) {
        logger.error('[standUp][leaveTableAsync] player: %s, err: ', JSON.stringify(player), err);
    }
});

proto.onPlayerLogoutAsync = cort(function* (player, accessToken, fireServerId, betSetting) {
    try {
        let self = this;
        if (!!player && !!player.tableId) {
            return this.checkAndLeaveTable(player, true, accessToken, fireServerId, betSetting);
        }
        if (!!player && player.gameServerId == self.app.getServerId()) {
            return self.app.memdb.goose.transactionAsync(function () {
                return self.app.controllers.fishHunterPlayer.offlineAsync(player._id);
            }, self.app.getServerId())
                .then(data => {
                    return {error: null};
                })
                .catch(err => {
                    logger.error('[standUp][onPlayerLogoutAsync][offlineAsync] player: %s, err: ', JSON.stringify(player), JSON.stringify(err));
                    return {error: C.ERROR};
                })
        } else {
            return P.resolve({error: C.ERROR});
        }
    } catch (err) {
        logger.error('[standUp][onPlayerLogoutAsync] player: %s, err: ', JSON.stringify(player), JSON.stringify(err));
    }
});

// proto.settleAndDepositAsync = cort(function*(player, table) {
//     let self = this;
//     let ret = yield self.app.controllers.fishHunterPlayer.walletToAccountAsync(player._id, player.gameId, 0, 'settle deposit', true, player );

//     if (!!ret) {
//         self.app.controllers.table.pushAsync(table._id, null, consts.route.client.game.UPDATE_WALLET, ret, false);
//         return {error:null}
//     }
//     else {
//         this.app.controllers.debug.info('err','settleAndDepositAsync',{playerId: player._id, walletToAccountAsyncRet: ret  } );
//         return {error:C.FAILD};
//     }
// });

proto.accountCleanupAsync = cort(function* (player, oldRoundId, betSetting) {

    try {
        // let playerControl = this.app.controllers.fishHunterPlayer;
        // if (!!player.gameId) {
        //     yield playerControl.walletToAccountAsync(player, 0, 'cleanup', true);
        // }
        let tableId = player.tableId;
        let areaId = player.areaId;
        let creditAmount = null;
        let playerId = player._id;

        if (!!areaId) {
            let modelAreaPlayers = this.app.models.FishHunterAreaPlayers;
            let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId, playerId});
            let beforeBalance = 0;
            let afterBalance = 0;
            let gain = 0;
            let cost = 0;
            let lastFireTime = Date.now();
            let tokenDao = this.app.controllers.daoMgr.getGameTokenDao();
            let tokens = yield tokenDao.findOneAsync(playerId, player.gameId, true);
            if (!!tokens) {
                if (player.isSingleWallet !== consts.walletType.singleBetAndWinDelay) {
                    logger.warn('[standUp][accountCleanupAsync] playerId: %s, tokens: %s', playerId, JSON.stringify(tokens));
                    beforeBalance = tokens.oneAreaExchange;
                    afterBalance = tokens.balance;

                    gain = tokens['subtotalGain'];
                    cost = tokens['subtotalCost'];

                    lastFireTime = tokens.lastFireTime;

                    if (tokens.frozenGain !== 0 || tokens.frozenCost !== 0) {
                        logger.error('[standUp][accountCleanupAsync] wallet frozen Error ', util.inspect(tokens.toObject(), false, 10));
                    }

                    if (gain < 0 || cost < 0) {
                        logger.error('[standUp][accountCleanupAsync] wallet subtotal Error ', util.inspect(tokens.toObject(), false, 10));

                        gain = 0;
                        cost = 0;
                    }
                    creditAmount = yield tokenDao.resetAsync(player, null, betSetting); // 退款機制
                }
            } else {
                logger.warn('[standUp][accountCleanupAsync] err: tokens: %s, playerId: %s, gameId: %s', tokens, playerId, player.gameId);
            }

            if (!!areaPlayer) {
                // 後扣型單錢包，不補寫母單。
                if (player.isSingleWallet !== consts.walletType.singleBetAndWinDelay) {
                    let saveHistory = true;
                    let gameTypeId = consts.gameTypeId;
                    // areaPlayer.bullets = [];
                    let areaPlayerData = areaPlayer.toObject();
                    //母單編號:
                    if (!tokens) {
                        areaPlayerData._id = utils.getWId(playerId, player.gameId);
                    } else {
                        areaPlayerData._id = tokens.wagerId == '' ? utils.getWId(playerId, player.gameId) : tokens.wagerId;
                        if (tokens.wagerId == '') {
                            // 用 areaId+playerId 查子單的 wId
                            logger.error(`[standUp][accountCleanupAsync][手動補單] playerId: ${playerId}, roundId: ${oldRoundId}, areaPlayer: ${JSON.stringify(areaPlayer)}, tokens: ${JSON.stringify(tokens)}`);
                            // 特殊情況，不儲存資料錯誤的母單，暫由人工補單並且查詢原因 // 目前已由登入時，擋住不重複執行登入流程，防止 session 殘留導致執行兩次離桌流程
                            saveHistory = false;
                        }
                        gameTypeId = tokens.gameTypeId;
                    }
                    areaPlayerData.lastFireTime = utils.timeConvert(lastFireTime);
                    areaPlayerData.gain = gain;
                    areaPlayerData.cost = cost;
                    areaPlayerData.createTime = utils.timeConvert(Date.now(), true);

                    // 儲存mongo母單
                    let mongoWagers = new this.app.models.FishHunterAreaPlayersHistory(areaPlayerData);
                    mongoWagers.beforeBalance = beforeBalance; // 玩家帶入桌的金額
                    mongoWagers.afterBalance = afterBalance;   // 玩家離桌後的金額
                    mongoWagers.createTime = utils.timeConvert(Date.now(), true); // 寫入離場時間
                    mongoWagers.roundID = oldRoundId || player.roundID;
                    mongoWagers.gameTypeId = gameTypeId;
                    logger.info(`[母單][standUp][accountCleanupAsync][${saveHistory}] areaPlayersHistory:`, mongoWagers);
                    if (saveHistory) yield mongoWagers.saveAsync(); //寫入歷史注單
                    mongoWagers['isSingleWallet'] = player.isSingleWallet == 0 ? 0 : 1;
                    // 寫 MySQL 母單
                    if (saveHistory) yield this.app.controllers.wagers.addWagers(player, mongoWagers);
                }
                yield areaPlayer.removeAsync();
            } else {
                logger.warn('[standUp][accountCleanupAsync] err: areaPlayer not found: %s, playerId: %s, gameId: %s', areaPlayer, playerId, player.gameId);
            }
        }

        if (!!tableId) {
            yield this.app.controllers.table.quitAsync(tableId, player._id, null);
        }

        let re_player = yield this.app.controllers.fishHunterPlayer.internalUpdateAsync(player._id, {
            gameState: consts.GameState.FREE,
            tableId: '',
            areaId: ''
        });
        return {error: null, player: re_player, creditAmount}
    } catch (err) {
        logger.error('[standUp][accountCleanupAsync] player: %s, catch err: ', JSON.stringify(player), err);
        return {error: C.ERROR}
    }
});

// 玩家離場了->開始"停止射擊"->檢查剩餘已出現在場上但尚未擊中魚的子彈
proto.stopFireAsync = cort(function* (player, gameId, areaId, gameServerId, betSetting) {
    let self = this;
    let cache = self.app.controllers.fishHunterCache;
    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} start. // gameId: ${gameId}, areaId: ${areaId}, gameServerId: ${gameServerId}, thisServerId: ${self.app.getServerId()}`);

    return P.resolve(0)
        .then(() => { //離場開始檢查: 如果還有飛行中的子彈 =>進行退款
            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 1.`);

            return self.app.memdb.goose.transactionAsync(cort(function* () {
                let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
                let areaPlayer = yield modelAreaPlayers.findOneReadOnlyAsync({areaId: areaId, playerId: player._id});

                if (!areaPlayer) {
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 1-1.`);
                    return {error: C.PLAYER_NOT_PLAYING};
                } else {
                    // 處理特殊武器退款 & 子單紀錄退款(含一般子彈)
                    const res = yield self.handleRefund(areaPlayer, player);
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 1-2.`);
                    return {
                        error: null,
                        refund: res.refund,
                        returnInfo: res.returnInfo,
                        bet: res.bet,
                        wId: ''
                    };
                }
            }), gameServerId);
        })
        .then((data) => {   //離場檢查特殊炮:真正進行退款
            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2. data: ${JSON.stringify(data)}`);
            if (!data.error && data.refund > 0) {
                const refund = data.refund;
                const returnInfo = data.returnInfo;
                let bulletId = Date.now();
                return self.app.memdb.goose.transactionAsync(cort(function* () {
                    let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(player._id, gameId);
                    if (!!memWallet) {
                        logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2-1.`);
                        let deferred = P.defer();
                        let ret = memWallet.reward(refund, false, 1, (err, data) => {
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2-1-1.`);
                            const {wagerId, idx, betSucc, winSucc, gain} = data;
                            logger.info('stopFireAsync reward ', util.inspect({
                                playerId: player._id,
                                wagerId,
                                idx,
                                gain,
                                betSucc,
                                winSucc
                            }, false, 10));

                            if (!err && winSucc) {
                                //正常
                            } else {
                                //错误处理
                                logger.warn('stopFireAsync reward fail. ', util.inspect({
                                    playerId: player._id,
                                    wagerId,
                                    idx,
                                    gain,
                                    betSucc,
                                    winSucc
                                }, false, 10), err);
                            }

                            deferred.resolve()
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2-1-1 done.`);
                        });

                        yield deferred.promise;
                        const record = {
                            demo: player.demo,
                            areaId,
                            playerId: player._id,
                            returnInfo,
                            refund,
                            bulletId,
                            wId: ret.wagerId,
                            idx: ret.lastIndex,
                            denom: 1,
                            bet: data.bet
                        };
                        yield self.app.controllers.bullet.AddRefund(record); // 子單寫入歸還紀錄
                        logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2-1-2.`);

                        let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
                        let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: areaId, playerId: player._id});
                        if (!!areaPlayer) {
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2-1-3.`);
                            areaPlayer.gain = utils.number.add(areaPlayer.gain, Math.abs(refund));
                            // areaPlayer.bullets = returnInfo.normal;   // 一般子彈返還紀錄
                            areaPlayer.gunInfo = returnInfo.weapon;     // 特殊武器返還記錄
                            yield areaPlayer.saveAsync();
                        }
                    }
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2 done.`);
                    return {
                        refund,
                        wId: player.isSingleWallet == consts.walletType.singleBetAndWinDelay ? utils.getWId(player._id, player.gameId) : data.wId,
                        bulletId
                    };
                }), gameServerId)
            } else {
                logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 2-2.`);
                return {refund: 0, wId: data.wId};
            }
        })
        .then(data => {
            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 3. data: ${JSON.stringify(data)}`);
            // 找集寶器設定檔
            let collectionDrawConfig = self.app.controllers.fishHunterConfig.getCollectionDrawConfig(gameId);
            if (!collectionDrawConfig) return data; // 它款遊戲

            // 檢查集寶器: 滿: 選固定賠率, 未滿: 清除
            return self.app.memdb.goose.transactionAsync(cort(function* () {
                // 取集寶器紀錄
                let modelCollection = self.app.models.CollectionHistory;
                let collectionId = modelCollection.getId(player._id, gameId);
                let collection = yield modelCollection.findByIdAsync(collectionId);
                logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 3-1.`);
                if (!collection) return data; // 無集寶器紀錄

                // 是否集滿
                if (collection.count < collectionDrawConfig.collectionCount) {
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 3-2.`);
                    // 清除集寶器紀錄
                    yield collection.removeAsync(); // 未集滿: 清除
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id}, LuckyDraw no full, delete. count: ${collection.count}, cost: ${collection.cost}, bulletId: ${collection.bulletId} `,);
                    return data;
                }
                logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 3-3.`);

                // 集滿: 選擇固定倍數
                let gain = utils.number.multiply(collection.cost, collectionDrawConfig.collectionAvgOdds);
                logger.info(`[standUp][stopFireAsync] playerId: ${player._id}, LuckyDraw refund: ${gain}, cost: ${collection.cost}, bulletId: ${collection.bulletId} `,);
                // 清除集寶器紀錄
                yield collection.removeAsync();

                // 試玩帳號 派彩 不進rc統計 // 先加 RC 再派彩
                if (!player.demo)
                    self.app.controllers.fishHunterRC.addRecord(player.currency, gameId, player.tableLevel, gain, self.app.controllers.fishHunterRC.RC_EVENT.GAIN, player.dc, betSetting.exchangeRate);

                let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(player._id, gameId);
                // let beforeBalance = memWallet.getRealTokens();
                memWallet.reward(gain, false, 1, (err, data) => {
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 3-3-1.`);
                    const {wagerId, idx, betSucc, winSucc} = data;
                    if (!err && betSucc && winSucc) {
                        //正常
                    } else {
                        //错误处理
                    }
                });
                let bulletData = {
                    wagerId: memWallet.wagerId,
                    bulletId: collection.bulletId,
                    gain: gain,
                    // afterBalance: memWallet.getRealTokens(),
                    // beforeBalance: beforeBalance,
                    shootType: collection.shootType,
                    denom: memWallet.ratio,
                    getInfo: {
                        originalCost: collection.cost,
                        treasure: {
                            odds: collectionDrawConfig.collectionAvgOdds,
                            bonus: gain,
                            type: 'LuckyDraw'
                        }
                    }
                }
                yield self.app.controllers.bullet.addLuckyDrawBulletHistory(player, bulletData);
                logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 3-3 done.`);
                return data;
            }), gameServerId);
        })
        .then(data => {
            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4. data: ${JSON.stringify(data)}`);
            let memWallet = null;
            return P.resolve()
                .then(() => {
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-1.`);
                    return self.app.controllers.walletMgr.getWalletAsync(player._id, gameId, true);
                })
                .then(async (res) => {
                    if (!!res) {
                        memWallet = res;
                        if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) {
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-2-1.`);
                            // 後扣型錢包 // 因為最外層(排程or離桌回到大廳)呼叫的地方，沒有執行把錢包設為結帳中&結帳完成，故在這邊做。
                            let tokensDao = self.app.controllers.daoMgr.getGameTokenDao();
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-2-1-1.`);
                            await tokensDao.settlePrepare(player._id, gameId); // 設定錢包結帳中
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-2-1-2.`);
                            let _memWallet = await memWallet.flushAsync();
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-2-1-3.`);
                            await tokensDao.settleComplete(player._id, gameId, true, true); // 設定錢包結帳完成
                            logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-2-1 done.`);
                            return _memWallet;
                        }
                        logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-2-2.`);
                        // 其他錢包
                        return memWallet.flushAsync();
                    } else {
                        logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-3.`);
                        return res;
                    }
                })
                .then(() => {
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-4 done.`);
                    return data;
                })
                .catch(err => {
                    logger.info(`[standUp][stopFireAsync] playerId: ${player._id} step 4-5. getWalletAsync flushAsync err: `, err);
                    return data;
                });
        })
        // .then((data) => {   //最後離場=>清除自己的子彈map 和做GameSubRecord
        //     self._doReportGameSubRecord(playerId,true, accessToken);
        //     return data;
        // })
        .catch(err => {
            logger.error('[standUp][stopFireAsync] playerId: %s, err: ', player._id, err);
            cache.clearCacheWhenPlayerOffLine(player._id, gameId);

            return {error: C.ERROR};
        })
});

// 處理特殊武器退款 & 子單紀錄退款(含一般子彈)
proto.handleRefund = cort(function* (areaPlayer, player) {
    try {
        const self = this;
        const playerId = areaPlayer.playerId;
        let returnInfo = {      // 返還資訊
            // normal: [],         // 一般子彈
            weapon: []          // 特殊武器
        };
        /*===處理 normal 一般子彈 返還紀錄 =====================*/
        // let normal = yield self.normalRefund(player, areaPlayer.currency, areaPlayer.gameId, areaPlayer.tableLevel, areaPlayer.isPromo);
        // returnInfo.normal = normal.refundList;
        // this.app.controllers.debug.info('info', 'handleRefund.normalRefund', { playerId, normal });
        // 清除子彈 cache
        /*===處理 weapon 特殊武器 返還紀錄 =====================*/
        let weapon = yield self.weaponRefund(player, _.cloneDeep(areaPlayer.gunInfo));
        returnInfo.weapon = weapon.refundList;
        this.app.controllers.debug.info('info', 'handleRefund.weaponRefund', {playerId, weapon});

        self.app.controllers.fishHunterCache.clearCacheWhenPlayerOffLine(player._id, areaPlayer.gameId);

        // let refund = utils.number.add(normal.refundBonus, weapon.refundBonus);
        // return { refund, returnInfo, bet: normal.refundBonus };
        return {refund: weapon.refundBonus, returnInfo, bet: 0};
    } catch (err) {
        logger.error('[standUp][handleRefund] areaPlayer: %s, err: ', JSON.stringify(areaPlayer), err);
    }
});

// proto.normalRefund = cort(function*(player, currency, gameId, tableLevel, isPromo) {
//     try {
//         let self = this;
//         let normal = [];
//         let refundBonus = 0;
//         let cache = self.app.controllers.fishHunterCache;
//         let playerId = player._id;
//         // let bullets = cache.bullets(playerId, false);
//         //
//         // if(bullets.length > 0) {
//         //   for(let i=0; i<bullets.length; i++) {
//         //     let b = bullets[i];
//         //
//         //     // if (player.isSingleWallet !== consts.walletType.singleBetAndWinDelay) {
//         //       let ret = yield self.app.controllers.bullet.FindReward( b.bulletId, playerId );
//         //       //有找到派獎的紀錄 => 不做退款動作了
//         //       if ( ret != true ) continue;
//         //
//         //       // 推廣帳號不進rc統計
//         //       if (!isPromo) {
//         //         //因為cost已扣掉所以補回
//         //         self.app.controllers.fishHunterRC.addRecord(currency, gameId, tableLevel, Math.abs(b.cost), self.app.controllers.fishHunterRC.RC_EVENT.COST);
//         //       }
//         //     // }
//         //
//         //     if(b.denom != 1) {
//         //       b.cost = utils.scoreToCash(b.cost, b.denom);
//         //       b.denom = 1;
//         //     }
//         //
//         //     refundBonus = utils.number.add(refundBonus, Math.abs(b.cost));
//         //
//         //     normal.push({
//         //       bulletId: b.bulletId,
//         //       gain:     Math.abs(b.cost)
//         //     });
//         //   }
//         //
//         // }
//
//         cache.clearCacheWhenPlayerOffLine(playerId, gameId);
//         return { refundList: normal, refundBonus, allCompleteVoucher: [] };
//
//     } catch (err) {
//         logger.error('[standUp][normalRefund] playerId: %s, err: ', player._id, err);
//     }
// });

proto.weaponRefund = cort(function* (player, gunInfo) {

    let self = this;
    let playerId = player._id;
    let cache = self.app.controllers.fishHunterCache;

    try {
        let weapons = [];
        let refundBonus = 0; // 加總返還金額
        if (gunInfo.length === 0) return {refundList: weapons, refundBonus}; // 沒有剩餘的特殊武器
        logger.info('[standUp][weaponRefund] playerId: %s, gunInfo: ', playerId, gunInfo);
        /*=== 檢查 特殊武器 剩餘子彈 =====================*/
        const paramConfig = self.app.controllers.fishHunterConfig.getParamDefinConfig(); // 取得參數設定檔
        let delBazooka = false;
        for (let gun of gunInfo) {
            if (paramConfig.weapon.indexOf(gun.type) == -1) { // none drill、laser
                logger.error('[standUp][weaponRefund] playerId: %s, Gun Type Error: %s', playerId, gun.type);
                continue;
            }
            if (gun.type === consts.FishType.BAZOOKA) delBazooka = true;

            // 已發射，未射完
            if (gun.bulletId > 0) {
                if (gun.type === consts.FishType.BAZOOKA) {
                    let bazooka = cache.getBazookaAlive(playerId, gun.cost);
                    if (!bazooka) continue;
                    gun.alive = bazooka.alive;
                    // gun.alive = bazooka.actualAlive;//bazooka.alive;
                } else {
                    let wp = _.cloneDeep(cache.getTreasure(playerId, gun.bulletId));
                    if (!wp) continue;
                    gun.alive = wp.alive;
                    // gun.alive = wp.actualAlive;//wp.alive;
                    cache.delTreasure(playerId, gun.bulletId);
                }
            }

            let getBullet = _.cloneDeep(gun.getBullet); // [{ bid: 1598953190158, alive: 60 }]
            for (let i = getBullet.length - 1; i >= 0; i--) {
                let billSucc = cache.getBetResult(playerId, getBullet[i].bid); // 扣款成功 or 失敗
                // if (billSucc) continue; // betResult 有回來 && 扣款成功，返還
                if (billSucc) {
                    continue;
                } else {
                    let hasResult = cache.hasBetResult(playerId, getBullet[i].bid); // 收到 betAndWin
                    if (hasResult) {
                        // betResult 有回來 && 扣款失敗，不返還
                    } else {
                        // betResult 沒回來，不返還
                    }
                }
                // 有失敗flag，不返還
                gun.alive -= getBullet[i].alive; // 得到免費武器的子彈扣款「失敗」，該免費子彈數量不返還
                gun.getBullet.splice(i, 1); // 刪除 gun(array) 得到免費武器扣款「失敗」的子彈
                // let delFlag = cache.delGetWeaponBulletFlag(playerId, player.gameId, getBullet[i].bid);
            }

            if (gun.alive > 0) {
                weapons.push({
                    cost: gun.cost,
                    type: gun.type,
                    bulletId: gun.bulletId,
                    leaveAlive: gun.alive,
                    getBullet: gun.getBullet,
                });

                // 返還金額加上這顆免費武器： (剩餘子彈數量 * 子彈成本)
                refundBonus = utils.number.add(refundBonus, utils.number.multiply(gun.alive, gun.cost));
            }

            if (gun.type === consts.FishType.BAZOOKA) {
                let delBazooka = cache.delBazookaAlive(playerId, gun.cost); // 刪除: 機關炮碰撞剩餘子彈數
                logger.info('[standUp][weaponRefund] playerId: %s, cost: %s, delBazooka: %s', playerId, gun.cost, delBazooka);
            }
        }/*=forEnd=*/

        return {refundList: weapons, refundBonus};
    } catch (err) {
        logger.error('[standUp][weaponRefund] playerId: %s, err: ', playerId, err);
        return {refundList: [], refundBonus: 0};
    }
});

// proto._doReportGameSubRecord = function (playerId,remove, token) {
//     try {
//         let self = this;
//         let cache = self.app.controllers.fishHunterCache;
//         let bullets = cache.findSubRecordField(playerId,'bullets');
//         if(!!bullets && bullets.length > 0) {
//             cache.setSubRecord(playerId,'bullets',[]);
//
//             return P.resolve(0)
//                 .then(()=>{
//                     let areaId = null;
//                     let gameServerId = null;
//                     let totalCost = 0;
//                     let totalGain = 0;
//                     let ids = [];
//                     let repeatBullets = {};
//                     let startTime = 0;
//                     let endTime = 0;
//                     let denom = bullets[0].denom;
//
//                     bullets.forEach((value,index,arr) => {
//
//                         if(value.denom != denom) {
//                             let tmp = cache.findSubRecordField(playerId,'bullets');
//                             tmp.unshift(value);
//
//                             return;
//                         }
//
//                         if(!repeatBullets[value.bulletId]) {
//                             totalCost = utils.number.add(totalCost, value.cost);
//                             repeatBullets[value.bulletId] = 1;
//                         }
//
//                         if(index == 0) {
//                             startTime = value.createTime;
//                         }
//                         else if(index == arr.length -1) {
//                             endTime = value.createTime;
//                         }
//
//                         totalGain = utils.number.add(totalGain, value.gain);
//                         ids.push({
//                             id:value.id,
//                             die:value.killFishes,
//                             fish:value.hitFishes,
//                             cost:value.cost,
//                             gain:value.gain,
//                             denom:value.denom
//                         });
//                         areaId = value.areaId;
//                         gameServerId = value.gameServerId;
//                     });
//
//                     return {
//                         cost:totalCost,gain:totalGain,areaId:areaId,ids:ids,
//                         playerId:playerId,gameServerId:gameServerId,
//                         startTime:startTime,endTime:endTime,
//                         denom:denom
//                     };
//                 })
//                 .then((data) => {
//                     let betId = cache.findSubRecordField(playerId,'betId');
//                     if(!betId) {
//                         betId = 0;
//                     }
//                     ++betId;
//                     cache.setSubRecord(playerId,'betId',betId);
//
//                     data.betId = betId;
//
//                     return data;
//                 })
//                 .then((data) => {
//                     return self.app.memdb.goose.transactionAsync(function () {
//                         let modelSubRecord = self.app.models.FishHunterSubRecord;
//                         let rec = new modelSubRecord({
//                             _id: uuid(),
//                             createTime: Date.now(),
//                             areaId: data.areaId,
//                             playerId: data.playerId,
//                             cost: data.cost,
//                             gain: data.gain,
//                             betId: data.betId,
//                             bullets: data.ids,
//                             fishSummary: self._fishAttackSummary(data.ids),
//                             denom:data.denom
//                         });
//
//                         return rec.saveAsync().then(()=>{
//                             return data;
//                         });
//                     },self.app.getServerId());
//                 })
//                 .then((data) => {
//                     let connectorId = cache.findSubRecordField(playerId,'connectorId');
//
//                     if(!!connectorId) {
//                         data.connectorId = connectorId;
//
//                         return data;
//                     }
//                     else {
//                         return self.app.memdb.goose.transactionAsync(cort(function* () {
//                             let player = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
//                             if(!!player) {
//                                 data.connectorId = player.connectorId;
//                                 cache.setSubRecord(playerId,'connectorId',data.connectorId);
//                                 cache.setSubRecord(playerId,'gameId',player.gameId);
//
//                                 let wallet = yield self.app.controllers.fishHunterPlayer.findWalletReadOnlyAsync(playerId,player.gameId);
//
//                                 if(!!wallet) {
//                                     cache.setSubRecord(playerId,'creditCode',wallet.creditCode);
//                                 }
//                             }
//
//                             return data;
//                         }),data.gameServerId);
//                     }
//                 })
//                 .then((data) => {
//                     let accessToken = cache.findSubRecordField(playerId,'token');
//                     if(!accessToken) {
//                         accessToken = token;
//                     }
//
//                     if(!accessToken) {
//                         if(!data.connectorId) {
//                             return P.reject('ReportGameSubRecord No connectorId');
//                         }
//                         let bss = self.app.get('backendSessionService');
//
//                         return P.promisify(bss.getByUid, bss)(data.connectorId, playerId)
//                             .then((sessions) => {
//                                 if (sessions && sessions.length > 0) {
//                                     accessToken = sessions[0].get('accessToken');;
//                                     cache.setSubRecord(playerId,'token',accessToken);
//                                     data.accessToken = accessToken;
//                                 }
//
//                                 return data;
//                             })
//                     }
//                     else {
//                         data.accessToken = accessToken;
//                         return data;
//                     }
//                 })
//                 .then((data) => {
//
//                     if(!data.accessToken) {
//                         //logger.info('ReportGameSubRecord No Token ',data);
//                         return data;
//                     }
//
//                     let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
//                     let url = config.webConnectorUrl;
//                     let gameId = cache.findSubRecordField(playerId,'gameId');
//                     let creditCode = cache.findSubRecordField(playerId,'creditCode');
//                     let params = {
//                         platform: 'bbin',
//                         method: 'reportSubRecord',
//                         token: data.accessToken,
//                         gain: data.gain,
//                         creditCode: creditCode,
//                         cost: data.cost,
//                         gameId: gameId,
//                         areaId:data.areaId,
//                         betId:data.betId,
//                         startTime:data.startTime,
//                         endTime:data.endTime
//                     };
//
//                     return utils.httpPost(url, params)
//                         .then(data => {
//
//                             if (!!data && data.status == '0000') {
//                                 logger.warn('reportSubRecord result ', data);
//                             }
//                             else {
//                                 logger.error('reportSubRecord FAIL ', data, ' params ', params);
//                             }
//                         })
//                         .catch(err => {
//                             logger.error('reportSubRecord error ', params,' err ',err);
//                         })
//                 })
//                 .then(() => {
//                     if(remove) {
//                         cache.delSubRecord(playerId);
//                     }
//                 })
//                 .catch((err) => {
//                     logger.error('_onReportGameSubRecord error ',playerId,' bullets ',bullets,' detail ',err);
//                 })
//         }
//         else {
//             if(remove) {
//                 cache.delSubRecord(playerId);
//             }
//         }
//     } catch (err) {
//         logger.error('[standUp][_doReportGameSubRecord] err: ', err);
//     }
// };

proto._fishAttackSummary = function (bullets) {
    try {
        if (!bullets || bullets.length == 0) {
            return {};
        }

        let result = {};

        for (let bullet of bullets) {
            let fish = bullet.fish;

            for (let t of fish) {
                let type = t;
                let arr = type.split('|');
                type = arr[0];

                if (!result[type]) {
                    result[type] = {
                        cost: 0,
                        gain: 0,
                        die: 0,
                        hit: 0,
                        type: arr[0]
                        // state:arr[1]
                    }
                }

                if (bullet.die) {
                    result[type].die++;
                }
                result[type].hit++;
                result[type].cost = utils.number.add(result[type].cost, bullet.cost);
                result[type].gain = utils.number.add(result[type].gain, bullet.gain);
            }
        }

        return result;
    } catch (err) {
        logger.error('[standUp][_fishAttackSummary] err: ', err);
    }
};

proto._findStartedAreaAsync = cort(function* (tableId, fields) {
    try {
        tableId = _.isString(tableId) ? tableId : tableId._id;

        if (!fields) {
            fields = '';
        } else {
            if (_.isString(fields)) {
                if (fields.search('/ state/') == -1) {
                    fields += ' state'
                }
            } else {
                fields['state'] = 1;
            }
        }
        let areas = this.app.controllers.fishHunterCache.findFishAreaByField('tableId', tableId);//yield modelArea.findOneReadOnlyAsync({tableId: tableId}, fields);

        if (!areas) return [];
        if (areas.state == consts.AreaState.START) return [areas];
        return [];
    } catch (err) {
        logger.error('[standUp][_findStartedAreaAsync] tableId: %s, err: ', tableId, err);
    }
});

// proto._onReportGameSubRecord = function () {
//     let self = this;
//     let cache = self.app.controllers.fishHunterCache;
//     let keys = cache.findSubRecordAll();
//
//     for (let k in keys) {
//         let playerId = keys[k];
//
//         self._doReportGameSubRecord(playerId,false);
//     }
// };

proto.clearAreaPlayer = cort(function* (areaId, playerId) {
    try {
        let area_cache = this.app.controllers.fishHunterCache.findFishArea(areaId);
        if (!!area_cache) { // 清除魚場 players 正在離桌的此位玩家
            let idx = area_cache._doc.players.indexOf(playerId);
            if (idx > -1) {
                area_cache._doc.players.splice(idx, 1);
                logger.info('[standUp][clearAreaPlayer] playerId: %s, delete players end. areaId: %s, players: ', playerId, areaId, area_cache._doc.players);
            }
        }
        return;
    } catch (err) {
        logger.error('[standUp][clearAreaPlayer] err: ', err);
        return;
    }
});

