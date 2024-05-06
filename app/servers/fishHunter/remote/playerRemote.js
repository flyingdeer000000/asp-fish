let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let utils = require('../../../utils/utils');
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等

let Remote = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Remote(app);
};

let proto = Remote.prototype;
let cort = P.coroutine;


proto.login = function (msg, frontendId, gameId, betSetting, cb) {
    let self = this;
    let controller = this.app.controllers.fishHunterPlayer;
    let rpc = this.app.rpc;
    let accountInfo = msg;
    let playerId = '';
    let player = null;
    logger.info(`[playerRemote][login] step 0, playerId: ${accountInfo.playerId}
  accountInfo: ${JSON.stringify(accountInfo)}`);

    return P.resolve(0)
        .then(() => {
            return self.app.memdb.goose.transactionAsync(P.coroutine(function* () {
                let ret = yield controller.createAsync(accountInfo);
                if (ret.error) return {
                    error: ret.error
                };
                player = ret.player;
                playerId = player._id;
                return {error: null, player, oldRoundId: ret.oldRoundId, oldGameId: ret.oldGameId};
            }), self.app.getServerId());
        })
        .then(async (res) => {
            if (!!res.error) {
                logger.warn('[playerRemote][login] player: %s, [res] 1 ', JSON.stringify(player), res);
                return res;
            }
            logger.info(`[playerRemote][login] step 1, playerId: ${playerId}, roundId: ${msg.roundID}
    res: ${JSON.stringify(res)}`);

            let data = res.player;
            let oldRoundId = res.oldRoundId;
            let gameSettlementDone = true;
            let oldGameId = res.oldGameId;

            if (!!data && !!data.connectorId && data.connectorId !== '') {
                // kick original connector
                let entryRemote = rpc.connector.accountRemote;
                return P.promisify(entryRemote.kickSync, entryRemote)({frontendId: data.connectorId}, playerId, data.gameId, consts.KickUserReason.MultiLogin)
                    .then(async function (res) {
                        let error = res && res.error ? res.error : `${C.FAILD}-${res}`;
                        logger.info(`[playerRemote][login] step 1-kick, playerId: ${playerId}, roundId: ${msg.roundID}, connectorId: ${data.connectorId}, code: ${error}, res: ${res && res.data ? JSON.stringify(res['data']) : res}`);

                        // 檢查上一場是否結帳完成 // 只檢查後扣錢包，多錢包在 createAsync 已檢查
                        gameSettlementDone = data.isSingleWallet === consts.walletType.singleBetAndWinDelay
                            ? await controller.getGameSettlementState(data, oldGameId, data.backendServerId)
                            : gameSettlementDone;

                        if (!gameSettlementDone) {
                            logger.info(`[playerRemote][login][${error}][${msg.roundID}] playerId: ${data._id}, gameSettlementDone: ${gameSettlementDone}, oldGameId: ${oldGameId}, gameId: ${gameId}, backendServerId: ${data.backendServerId}`);
                            return {error: C.SETTLEMENT_STILL_ON_GOING}; // 上一場未結帳完成
                        }

                        if (res.error === C.OK) {
                            data.tableId = '';
                            data.areaId = '';
                            data.gameState = consts.GameState.FREE;
                            data.creditAmount = 0;
                            // 域名設定使用的dc
                            player['dsUseDc'] = accountInfo.domainSetting.useDc;
                            // 踢完, 更新玩家餘額
                            let resultData = await controller.callFetchBalance(player);
                            if (!resultData || resultData.code !== C.OK) return {error: resultData.code};
                            data.creditAmount = resultData.amount;
                        } else {
                            // server shutdown kick faild

                            let playerDao = self.app.controllers.daoMgr.getPlayerDao();
                            let newPlayer = await playerDao.findByIdAsync(playerId, true);
                            // 檢查玩家是否有短時間多重登入，有另一流程處理離桌中 // 有則不繼續往下執行登入流程
                            if (newPlayer.gameState == consts.GameState.LEAVING) {
                                logger.info(`[playerRemote][login][${msg.roundID}] playerId: ${data._id}, player is leaving.`);
                                return {error: C.API_AUTH_FAIL};
                            } else {
                                // 玩家狀態不是離桌中，再次檢查上一場是否結帳完成
                                gameSettlementDone = await controller.getGameSettlementState(data, oldGameId, data.backendServerId);
                                if (!gameSettlementDone) {
                                    logger.info(`[playerRemote][login][${error}][${msg.roundID}] playerId: ${data._id}, gameSettlementDone: ${gameSettlementDone}, oldGameId: ${oldGameId}, gameId: ${gameId}, backendServerId: ${data.backendServerId}`);
                                    return {error: C.SETTLEMENT_STILL_ON_GOING}; // 上一場未結帳完成
                                }
                            }

                            if (!!data.areaId || !!data.tableId) {
                                // 玩家在遊戲內尚未離桌, 清除玩家 data & 寫母單
                                let result = await self.app.memdb.goose.transactionAsync(function () {
                                    return self.app.controllers.standUp.accountCleanupAsync(data, oldRoundId, betSetting);
                                }, self.app.getServerId());
                                if (!result.error) {
                                    data = result.player;
                                    if (result.creditAmount) data.creditAmount = result.creditAmount;
                                }
                            } else {
                                let tokenDao = self.app.controllers.daoMgr.getGameTokenDao();
                                // 讓登入觸發的轉出取到之前的 roundId
                                let oldPlayer = _.cloneDeep(player);
                                oldPlayer.roundID = oldRoundId;
                                // 域名設定使用的dc
                                oldPlayer['dsUseDc'] = accountInfo.domainSetting.useDc;
                                let creditAmount = await tokenDao.resetAsync(oldPlayer, null, betSetting);
                                if (creditAmount) data.creditAmount = creditAmount;
                            }

                            if (res.error == C.PLAYER_NOT_LOGIN) {
                                let log = {
                                    playerId: playerId,
                                    logType: consts.LogType.OUT,
                                    logDesc: consts.PlayerStateDesc.ServerShutdown, // 登出原因
                                    ip: player.loginIp,
                                    gameId: player.gameId,
                                    isMobile: player.clientType == 'web' ? 0 : 1,
                                    os: msg.os,
                                    osVersion: msg.osVersion,
                                    browser: msg.browser,
                                    browserVersion: msg.browserVersion,
                                }
                                // 寫登出資訊至 MySQL
                                if (!data.demo) self.app.controllers.log.addLog(log);
                            }

                        }

                        return {error: null, player: data};
                    })
            } else {
                // 檢查上一場是否結帳完成 // 只檢查後扣錢包，多錢包在 createAsync 已檢查
                gameSettlementDone = data.isSingleWallet == consts.walletType.singleBetAndWinDelay ? await controller.getGameSettlementState(data, oldGameId, data.backendServerId) : gameSettlementDone;
                if (!gameSettlementDone) {
                    logger.info(`[playerRemote][login][${msg.roundID}] playerId: ${data._id}, gameSettlementDone: ${gameSettlementDone}, oldGameId: ${oldGameId}, gameId: ${gameId}, backendServerId: ${data.backendServerId}`);
                    return {error: C.SETTLEMENT_STILL_ON_GOING}; // 上一場未結帳完成
                }
                return {error: null, player: data};
            }
        })
        .then((res) => {
            if (!!res.error) {
                if (res.error !== C.SETTLEMENT_STILL_ON_GOING && res.error !== C.API_AUTH_FAIL) logger.warn('[playerRemote][login] player: %s, [res] 2 ', JSON.stringify(player), res);
                return res;
            }
            player = res.player;
            if (!!player) {
                return self.app.memdb.goose.transactionAsync(P.coroutine(function* () {
                    if (!!player.creditAmount && accountInfo.MySQLWallet) {
                        // 發生狀況: 玩家重複登入，tokens寫回MySQL後，需要更新大廳左下角顯示金額 for錢包存在MySQL的帳號
                        accountInfo.creditAmount = player.creditAmount;
                    }
                    let tokenData = yield controller.createWalletAsync(accountInfo, gameId, player);
                    // 轉帳失敗: 回傳的key會有error，to前端data需更新成凍結狀態

                    if (!!tokenData.quota && accountInfo.creditAmount !== tokenData.quota) {
                        // 發生狀況: server shutdown，玩家的錢還在tokens內，createWallet把錢寫回去MySQL後，需要更新大廳左下角顯示金額
                        accountInfo.creditAmount = tokenData.quota;
                    }

                    // for 更新大廳的餘額
                    switch (accountInfo.isSingleWallet) {
                        // 單錢包
                        case consts.walletType.singleWallet:
                        case consts.walletType.singleBetAndWin:
                        case consts.walletType.singleBetAndWinDelay:
                            accountInfo.creditAmount = tokenData.balance;
                            break;
                        // 多錢包
                        case consts.walletType.multipleWallet:
                            if (!accountInfo.MySQLWallet) { // 錢包不是在MySQL的平台商
                                if (!!player.creditAmount)
                                    accountInfo.creditAmount = player.creditAmount; // 後踢前: 使用fetchBalance的餘額
                                else
                                    accountInfo.creditAmount = accountInfo.balance; // 正常登入: 使用登入時平台傳來的餘額
                            }
                            break;
                        // 假‧多錢包 or betAndWin
                        default:
                            accountInfo.creditAmount = tokenData.quota;
                            break;
                    }

                    logger.info(`[playerRemote][login] step 1, playerId: ${playerId}, roundId: ${msg.roundID}
        playerCreateOrUpdate: ${JSON.stringify(player)}, tokens: ${JSON.stringify(tokenData)}`);
                    return {error: null, player};
                }), self.app.getServerId());
            }
            return {error: null, player};
        })
        .then((res) => {
            if (!!res.error) {
                if (res.error !== C.SETTLEMENT_STILL_ON_GOING && res.error !== C.API_AUTH_FAIL) logger.warn('[playerRemote][login] player: %s, [res] 3 ', JSON.stringify(player), res);
                return res;
            }
            let data = res.player;
            if (!!data && (!!data.tableId || !!data.areaId || data.gameState != consts.GameState.FREE)) {
                return self.app.memdb.goose.transactionAsync(function () {
                    return self.app.controllers.standUp.accountCleanupAsync(player, null, betSetting);
                }, self.app.getServerId());
            } else {
                return {error: null, player: data};
            }
        })
        .then((res) => {
            if (!!res.error) {
                if (res.error !== C.SETTLEMENT_STILL_ON_GOING && res.error !== C.API_AUTH_FAIL) logger.warn('[playerRemote][login] player: %s, [res] 4 ', JSON.stringify(player), res);
                return res;
            }
            return self.app.memdb.goose.transactionAsync(P.coroutine(function* () {
                let data = yield controller.connectAsync(playerId, frontendId, gameId, accountInfo.accountState);
                data.playerId = playerId;

                accountInfo.gameServerId = data.data.player.gameServerId;
                accountInfo.gameId = data.data.player.gameId;
                accountInfo.tableId = data.data.player.tableId;
                accountInfo.player = data.data.player;

                // 增加在線玩家cache
                self.app.controllers.fishHunterCache.addOnlinePlayers(playerId, frontendId, accountInfo);
                logger.info('[playerRemote][login] playerId: %s, gameServerId: %s, add online player cache done.', playerId, frontendId);

                return accountInfo;
            }), self.app.getServerId());
        })
        .catch((err) => {
            logger.error('[playerRemote][login] msg: %s, catch err: ', JSON.stringify(msg), err);
            return {error: C.ERROR};
        })
        .nodeify(cb)
}


proto.logout = function (playerId, sessionData, reason, object, cb) {

    // proto.logout = function (playerId, accessToken, fireServerId, roundID, reason, cb) {
    logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 0`);

    let self = this;
    let controller = this.app.controllers.fishHunterPlayer;
    let player = null;
    P.resolve(playerId)
        .then(data => {
            logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 1`);
            return self.app.memdb.goose.transactionAsync(function () {
                return controller.findReadOnlyAsync(playerId);
            }, self.app.getServerId());
        })
        .then(data => {
            logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 2`);
            if (!data) {
                logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 2-1`);
                return P.reject('player ' + playerId + 'not found');
            } else {
                logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 2-2`);
                data['roundID'] = sessionData.roundID; // 場次編號
                player = data;
                player['dsUseDc'] = sessionData.domainSetting ? sessionData.domainSetting.useDc : player.dc;
                return self.app.controllers.standUp.onPlayerLogoutAsync(data, sessionData.accessToken, sessionData.fireServerId, sessionData.betSetting);
            }
        })
        .then(data => {
            logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 3 `, data);
            return self.app.memdb.goose.transactionAsync(cort(function* () {
                if (!!data.error) {
                    logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 3-1`);
                    // 離桌失敗執行
                    yield self.app.controllers.standUp.accountCleanupAsync(player, null, sessionData.betSetting);
                    return data;
                }

                switch (player.isSingleWallet) {
                    case consts.walletType.singleWallet:
                    case consts.walletType.singleBetAndWin:
                    case consts.walletType.singleBetAndWinDelay:
                        // 單錢包
                        return controller.clearTokensData(player);
                    case consts.walletType.multipleWallet:
                        player['roundID'] = sessionData.roundID; // 場次編號
                        player['launchToken'] = sessionData.accessToken; // 被踢的人的token
                        return controller.walletToAccountAsync(player, 'logout', sessionData.betSetting);
                    default:
                        //弹夹型单钱包，结算在wallet中处理
                        return controller.clearTokensData(player);
                }
            }), self.app.getServerId());
        })
        .then(data => {
            logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 4`);
            controller.disconnectAsync(playerId, player.connectorId); // 斷 globalChannelService
            // 特殊錯誤 ex. {errno:ENOTFOUND,code:ENOTFOUND,syscall:getaddrinfo,hostname:apiserver-webconnector-fish-prod-1-ss-svc,host:apiserver-webconnector-fish-prod-1-ss-svc,port:8083}
            if (!data) return {error: C.ERROR, reason: 'logout wallet fail.'};
            if (data.error === C.ERROR) return data;
            return {error: C.OK, data};
        })
        .then((data) => {
            logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, step: 5`);
            if (!!player) {
                if (data.error === C.ERROR) {
                    reason = data.reason;
                }
                let log = {
                    playerId: playerId,
                    logType: consts.LogType.OUT,
                    logDesc: reason, // 登出原因
                    ip: player.loginIp,
                    gameId: player.gameId,
                    isMobile: player.clientType == 'web' ? 0 : 1,
                    os: sessionData.os,
                    osVersion: sessionData.osVersion,
                    browser: sessionData.browser,
                    browserVersion: sessionData.browserVersion,
                }
                // 寫登出資訊至 MySQL
                if (player.demo !== consts.demoType.demo) self.app.controllers.log.addLog(log);

                // 清除在線玩家cache
                let del = self.app.controllers.fishHunterCache.delOnlinePlayer(playerId);
                logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId}, connectorId: ${player.connectorId}, delete online player cache: ${del}`);

                // 清除快取請求防禦紀錄
                self.app.controllers.fishHunterCache.clearAllRequestData(playerId, sessionData.gameId);

                // // 清除惡意連續事件請求的紀錄
                // const requestDefConf = self.app.controllers.fishHunterConfig.getRequestDefConfig();
                // self.app.controllers.redisCache.clearRequestDef(playerId, requestDefConf);

                logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId} logout done.`);
                return {error: C.OK, data: data.data};
            } else {
                logger.info(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId} step: 5-1`);
                return {error: C.PLAYER_NOT_FOUND};
            }
        })
        .catch((err) => {
            logger.error(`[playerRemote][logout][${sessionData.roundID}] playerId: ${playerId} err:`, err);
            return {error: C.ERROR};
        })
        .nodeify(cb)
};

proto.clearPlayer = function (playerId, cb) {
    logger.info('[playerRemote][clearPlayer] playerId: %s', playerId);
    let self = this;
    return P.resolve()
        .then(() => {
            let del = self.app.controllers.fishHunterCache.delOnlinePlayer(playerId);
            logger.info('[playerRemote][clearPlayer] playerId: %s, delete online player cache:', playerId, del);
            return {error: C.OK};
        })
        .catch((err) => {
            logger.error('[playerRemote][clearPlayer] playerId: %s, err: ', playerId, err);
            return {error: C.ERROR};
        })
        .nodeify(cb)
};

// proto.settleAccountForce = function (playerId, cb) {
//   let self = this;
//   let controller = this.app.controllers.fishHunterPlayer;
//
//   self.app.memdb.goose.transaction(P.coroutine(function*() {
//     let player = yield controller.findReadOnlyAsync(playerId);
//     let handle = false;
//
//     let bss = self.app.get('backendSessionService');
//
//     logger.info('settleAccountForce playerId ', playerId, ' ', player);
//     if (!!player && player.gameServerId == self.app.getServerId()) {
//       if (!!player.connectorId) {
//         let bs = yield P.promisify(bss.getByUid, bss)(player.connectorId, playerId);
//         logger.info('getBackendSession ', bs);
//
//         if (!!bs) {
//           handle = true;
//
//           logger.info('kickByBackend ', playerId);
//           yield P.promisify(bss.kickByUid, bss)(player.connectorId, playerId);
//         }
//       }
//
//       if (!handle) {
//         logger.info('settle byBackend ');
//
//         yield self.app.controllers.standUp.onPlayerLogoutAsync(player, true);
//         logger.info('player %s settleAccountForce', playerId);
//         yield controller.disconnectAsync(playerId, player.connectorId);
//         logger.info('player %s settleAccountForce disconnect channel ');
//       }
//     }
//
//   }), self.app.getServerId())
//   .nodeify(cb)
//   .then(() => {
//     self.app.event.emit('transactionSuccess')
//   })
//   .catch((err) => {
//     self.app.event.emit('transactionFail');
//     logger.error('playerRemote settleAccountForce reject ', err);
//   });
// }
