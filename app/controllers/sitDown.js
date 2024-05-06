'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');
const uuid = require('uuid/v1');
const Mona = require("../dao/mona");

let SitDownController = function (app) {
    this.app = app;
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new SitDownController(app);
};

const proto = SitDownController.prototype;
const cort = P.coroutine;

proto.searchAndJoinTable = async function (player, params) {


    try {

        let self = this;
        if (!!player.tableId) {
            throw new Error("TABLE_HAS_ALREADY");
        }

        if (player.gameState !== '' && player.gameState !== consts.GameState.FREE) {
            throw new Error("PLAYER_NOT_FREE");
        }

        if (!player.gameId || !player.connectorId) {
            throw new Error("PLAYER_NOT_LOGIN");
        }

        switch (player.isSingleWallet) {
            case consts.walletType.singleBetAndWinDelay:
                // // 檢查入房最低額度(此時amount是遊戲中的餘額不是平台即時餘額)
                // let tokens = yield self.app.models.GameTokens.findOneReadOnlyAsync({playerId: player._id, gameId: player.gameId});
                // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
                // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
                // if (tokens.amount < currencyConfig[(player.currency)].room.minRequest[params.level]) return {error: C.TABLE_INSUFFICIENT_LIMIT};
                break;
            default:
                break;
        }

        const roomControl = this.app.controllers.room;
        params['currency'] = player.currency;   // 傳入玩家幣別

        const table = await roomControl.searchAndJoin(
            player._id,
            player.connectorId,
            player.gameId,
            params
        );

        if (!table) {
            self.app.controllers.debug.info('err', 'searchAndJoinTable', {
                playerId: player._id,
                reason: 'Table Not Exist'
            });
            throw new Error("Table Not Exist");
        }

        const playerControl = self.app.controllers['fishHunterPlayer'];
        let oldTableId = null;
        const newPlayer = await playerControl.internalUpdate(player._id, {
            tableId: table._id,
            tableLevel: table.level
        }, (p) => {
            oldTableId = p.tableId;
            return !p.tableId;
        });

        if (!newPlayer) {
            this.app.controllers.debug.info('err', 'searchAndJoinTable', {
                playerId: player._id,
                oldTableId,
                reason: 'already in table'
            });
            throw new Error("TABLE_HAS_ALREADY");
        }

        const gameControl = self.app.controllers['fishHunterGame'];
        await gameControl.pushTableMsg(
            player, table,
            consts.route.client.table.JOIN,
            true
        );

        // yield self.app.controllers.fishHunterGame.pushTableMsgAsync(player, table, consts.route.client.table.JOIN, true);

        return {
            error: null,
            data: {
                table: {
                    tableId: table._id,
                    playerIds: table.playerIds
                }
            }
        };
    } catch (ex) {
        logger.error('[sitDown][searchAndJoinTable] player: %s, ex: ', JSON.stringify(player), ex);
        throw ex;
    }

};


proto.searchAndJoinTableAsync = cort(function* (player, params) {
    try {
        let self = this;
        if (!!player.tableId) {
            return {error: C.TABLE_HAS_ALREADY};
        }

        if (player.gameState != '' && player.gameState != consts.GameState.FREE) {
            return {error: C.PLAYER_NOT_FREE};
        }

        if (!player.gameId || !player.connectorId) {
            return {error: C.PLAYER_NOT_LOGIN};
        }

        switch (player.isSingleWallet) {
            case consts.walletType.singleBetAndWinDelay:
                // // 檢查入房最低額度(此時amount是遊戲中的餘額不是平台即時餘額)
                // let tokens = yield self.app.models.GameTokens.findOneReadOnlyAsync({playerId: player._id, gameId: player.gameId});
                // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
                // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
                // if (tokens.amount < currencyConfig[(player.currency)].room.minRequest[params.level]) return {error: C.TABLE_INSUFFICIENT_LIMIT};
                break;
            default:
                break;
        }

        let roomControl = this.app.controllers.room;
        params['currency'] = player.currency;   // 傳入玩家幣別
        let table = yield roomControl.searchAndJoinAsync(player._id, player.connectorId, player.gameId, params);

        if (!table) {
            self.app.controllers.debug.info('err', 'searchAndJoinTable', {
                playerId: player._id,
                reason: 'table Not Exist'
            });
            return {error: C.ERROR};
        }

        let playerControl = self.app.controllers.fishHunterPlayer;
        let oldTableId = null;
        let newPlayer = yield playerControl.internalUpdateAsync(player._id, {
            tableId: table._id,
            tableLevel: table.level
        }, (p) => {
            oldTableId = p.tableId;
            return !p.tableId;
        });

        if (!newPlayer) {
            this.app.controllers.debug.info('err', 'searchAndJoinTable', {
                playerId: player._id,
                oldTableId,
                reason: 'already in table'
            });
            return {error: C.TABLE_HAS_ALREADY}
        }

        yield self.app.controllers.fishHunterGame.pushTableMsgAsync(player, table, consts.route.client.table.JOIN, true);

        return {error: null, data: {table: {playerIds: table.playerIds}}};
    } catch (err) {
        logger.error('[sitDown][searchAndJoinTableAsync] player: %s, err: ', JSON.stringify(player), err);
    }
});


proto.sitDown = async function (player, betSetting) {
    try {
        if (!player.tableId) {
            throw new Error("TABLE_NOT_FOUND")
        }

        if (player.gameState !== '' && player.gameState !== consts.GameState.FREE) {
            throw new Error("PLAYER_NOT_FREE");
        }

        const self = this;
        // let config = this.app.controllers.fishHunterConfig.getRoomConfig(player.gameId);
        const level = player.tableLevel || 1;
        // config = config.room[level];

        switch (player.isSingleWallet) {
            case consts.walletType.singleBetAndWinDelay:
                // // 檢查入房最低額度(此時amount是遊戲中的餘額不是平台即時餘額)
                // let tokens = yield self.app.models.GameTokens.findOneReadOnlyAsync({playerId: player._id, gameId: player.gameId});
                // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
                // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
                // if (tokens.amount < currencyConfig[(player.currency)].room.minRequest[player.tableLevel]) return {error: C.TABLE_INSUFFICIENT_LIMIT};
                break;
            default:
                break;
        }

        // let sitDownPlayer = yield this.app.controllers.fishHunterPlayer.internalUpdateAsync(player._id, {gameState: consts.GameState.READY});
        const sitDownPlayer = await this.app.controllers.fishHunterPlayer.internalUpdate(player._id, {gameState: consts.GameState.READY});

        // let table = yield this.app.controllers.table.findReadOnlyAsync(sitDownPlayer.tableId);
        const table = await this.mona.get({
            schema: this.app.models['Table'],
            id: sitDownPlayer.tableId,
        });

        const data = {
            tableId: sitDownPlayer.tableId
        }

        self.app.controllers.table.pushTable(
            sitDownPlayer.tableId,
            [],
            consts.route.client.game.SIT_DOWN,
            data,
            false
        );

        this.app.timer.setTimeout(cort(function* () {
            //   yield self.startGameAsync(sitDownPlayer, ret.table);
            yield self.startGameAsync(sitDownPlayer, table, betSetting);
        }), 1000);

        return {error: null};
    } catch (err) {
        logger.error('[sitDown][sitDown] player: %s, err: ', JSON.stringify(player), err);
        throw err;
    }
};


proto.sitDownAsync = cort(function* (player, betSetting) {
    try {
        if (!player.tableId) return {error: C.TABLE_NOT_FOUND};

        if (player.gameState !== '' && player.gameState !== consts.GameState.FREE) {
            return {error: C.PLAYER_NOT_FREE}
        }

        let self = this;
        // let config = this.app.controllers.fishHunterConfig.getRoomConfig(player.gameId);
        let level = player.tableLevel || 1;
        // config = config.room[level];

        switch (player.isSingleWallet) {
            case consts.walletType.singleBetAndWinDelay:
                // // 檢查入房最低額度(此時amount是遊戲中的餘額不是平台即時餘額)
                // let tokens = yield self.app.models.GameTokens.findOneReadOnlyAsync({playerId: player._id, gameId: player.gameId});
                // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
                // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
                // if (tokens.amount < currencyConfig[(player.currency)].room.minRequest[player.tableLevel]) return {error: C.TABLE_INSUFFICIENT_LIMIT};
                break;
            default:
                break;
        }

        let sitDownPlayer = yield this.app.controllers.fishHunterPlayer.internalUpdateAsync(player._id, {gameState: consts.GameState.READY});
        let table = yield this.app.controllers.table.findReadOnlyAsync(sitDownPlayer.tableId);
        // let ret = yield this.app.controllers.fishHunterGame.pushTableMsgAsync(sitDownPlayer, sitDownPlayer.tableId, consts.route.client.game.SIT_DONW, true);
        let data = {
            tableId: sitDownPlayer.tableId
        }
        self.app.controllers.table.pushAsync(sitDownPlayer.tableId, [], consts.route.client.game.SIT_DOWN, data, false);

        this.app.timer.setTimeout(cort(function* () {
            //   yield self.startGameAsync(sitDownPlayer, ret.table);
            yield self.startGameAsync(sitDownPlayer, table, betSetting);
        }), 1000);

        return {error: null};
    } catch (err) {
        logger.error('[sitDown][sitDownAsync] player: %s, err: ', JSON.stringify(player), err);
    }
});

proto.startGameAsync = cort(function* (player, tableId, betSetting) {
    let logWarn = false;
    try {
        if (!tableId) {
            logWarn = true;
            throw (`table not exsit: ${JSON.stringify(tableId)}`);
        }
        // tableId = _.isString(tableId) ? tableId : tableId._id;
        let oldTable = tableId;
        tableId = _.isString(tableId) ? tableId : tableId._id;

        // let table = yield this.app.controllers.table.findOneAsync(tableId);
        let table = yield this.app.controllers.table.findReadOnlyAsync(tableId);
        logger.warn('[sitDown][startGameAsync] playerId: %s, tableId: %s, tableId typeof: ', player._id, tableId, typeof tableId);

        if (!_.isString(oldTable) && !!table) {
            let oldChairIdStr = oldTable.chairIds.join(',');
            let newChairIdStr = table.chairIds.join(',');
            if (oldChairIdStr != newChairIdStr) {
                logger.warn('[sitDown][startGameAsync] oldChairIdStr != newChairIdStr ');
                logger.warn('[sitDown][sitDownAsync] playerId: %s, oldChairIdStr: %s', player._id, oldChairIdStr);
                logger.warn('[sitDown][sitDownAsync] playerId: %s, newChairIdStr: %s', player._id, newChairIdStr);
            }
        }

        let self = this;
        if (!table) {
            logWarn = true;
            throw (`tableId: ${tableId}, table not exsit: ${JSON.stringify(table)}`);
        }

        let bss = self.app.get('backendSessionService');
        let sessions = yield P.promisify(bss.getByUid, bss)(player.connectorId, player._id);
        let fireServerId = null;
        if (!!sessions && sessions.length > 0) {
            let server = utils.hashDispatch(player._id, self.app.getServersByType('fishHunterBackend'));
            if (!!server) {
                for (let idx in sessions) {
                    logger.info('[sitDown][startGameAsync] playerId: %s, fireServer: %s, sessionId: %s', player._id, server.id, sessions[idx].id);
                    sessions[idx].set('fireServer', server.id);
                    sessions[idx].pushAll(function (err, data) {
                    });
                    fireServerId = server.id;
                }
            } else {
                logger.error('[sitDown][startGameAsync] not find BackendServer playerId: %s, fireServer: %s', player._id, server);
                // 送前端訊息入桌失敗
                self.app.controllers.fishHunterPlayer.pushAsync(player._id, consts.route.client.game.START, {code: C.ERROR}, false);
                yield self.handlerSessionClose(player, null, '[startGameAsync] Not find backendServer.');
                return;
            }
        } else {
            // 找不到 session 表示: 玩家已登出或斷線，處理入桌失敗程序後 return
            logger.warn('[sitDown][startGameAsync] not find session. playerId: %s, ', player._id, sessions);
            // 送前端訊息入桌失敗
            self.app.controllers.fishHunterPlayer.pushAsync(player._id, consts.route.client.game.START, {code: C.ERROR}, false);
            yield self.handlerSessionClose(player, null, '[startGameAsync] Not find session.');
            return;
        }

        let area = null;
        let tempBG = null;
        let isReJoinArea = false;   //true: joinArea 失敗補救
        // let isAreaState = yield self.isAreaStateAsync(table._id);
        let isAreaState = self.isAreaStateAsync(table._id);
        if (!!isAreaState && isAreaState.state == consts.AreaState.START) {
            // area = yield self.joinAreaAsync(player._id, table);
            area = yield self.joinAreaAsync(player, table, betSetting);

            if (!area || area.error == C.ERROR) {
                isReJoinArea = true;
            }
            // else {
            //   yield this.updateScene(player._id, area.data.area.id); // 畫面同步
            // }
        }
        // 魚場狀態不為started
        else if (!!isAreaState) {
            isReJoinArea = true;
        }
        // 該桌沒有漁場:新增一個
        else {
            // area = yield self.initAreaAsync(player._id, table);
            area = yield self.initAreaAsync(player, table, betSetting);
        }

        if (isReJoinArea) {
            tempBG = yield self.ReJoinArea(player, table, betSetting); //joinArea 失敗補救
            table = tempBG.table;
            area = tempBG.area;
        }

        let data = null;
        if (!!area && !area.error) {
            data = area.data;
            let playerIds = table.chairIds.filter((p) => !!p && p != '');
            logger.info('[sitDown][startGameAsync] playerId: %s, playerIds: ', player._id, playerIds);
            logger.info('[sitDown][startGameAsync] playerId: %s, data.areaPlayers: ', player._id, data.areaPlayers);
            let players = [];
            let _areaplayers = [];  //data.areaPlayers push出去的
            let leavePlayerId = [];
            let eachPlayerIdInArea;
            // let collectionDrawConfig = self.app.controllers.fishHunterConfig.getCollectionDrawConfig(player.gameId);
            for (let i = 0; i < playerIds.length; i++) {
                logger.info('[sitDown][startGameAsync] playerId: %s, i: ', player._id, i);
                // eachPlayerIdInArea = data.areaPlayers[i].playerId;
                eachPlayerIdInArea = playerIds[i];
                // 找出該玩家在 data.areaPlayers 的 index
                let areaPlayerIdx = -1;
                data.areaPlayers.map((item, idx) => {
                    if (item.playerId == eachPlayerIdInArea) {
                        areaPlayerIdx = idx;
                        return;
                    }
                });

                if (eachPlayerIdInArea == player._id) {
                    // 剛坐下的玩家資訊
                    let sitDownPlayer = yield self.app.memdb.goose.transactionAsync(function () {
                        return self.app.controllers.fishHunterPlayer.internalUpdateAsync(eachPlayerIdInArea, {
                            areaId: data.area.id,
                            gameState: consts.GameState.PLAYING,
                            backendServerId: fireServerId
                        });
                    }, self.app.getServerId());
                    // 剛坐下的玩家錢包資訊
                    let playerWallet = yield self.app.controllers.fishHunterPlayer.findWalletReadOnlyAsync(sitDownPlayer._id, sitDownPlayer.gameId);
                    let playerInfo = sitDownPlayer.toClientData();
                    if (!!playerWallet) {
                        playerInfo.gold = playerWallet.amount;
                    }

                    // 加入集寶器
                    // let modelCollection = self.app.models.CollectionHistory;
                    // let collectionId = modelCollection.getId(sitDownPlayer._id, sitDownPlayer.gameId);
                    // let collection = yield modelCollection.findByIdReadOnlyAsync(collectionId);
                    // if (collection)
                    //   data.areaPlayers[i].luckyDraw = {       // 幸運抽獎
                    //     trigger: (collection.count >= collectionDrawConfig.collectionCount),  // 是否觸發
                    //     count: collection.count      // 進度
                    //   };

                    players.push({
                        nickName: playerInfo.nickName,
                        id: playerInfo.id,
                        gold: playerInfo.gold,
                    });
                    if (areaPlayerIdx == -1 || !data.areaPlayers[areaPlayerIdx]) logger.error(`[sitDown][startGameAsync] playerId: ${player._id}, areaPlayerIdx: ${areaPlayerIdx}, not find sitDownAreaPlayer. areaPlayers: `, data.areaPlayers);
                    else _areaplayers.push(data.areaPlayers[areaPlayerIdx]);
                } else {
                    // 原本就在桌裡的玩家
                    if (areaPlayerIdx == -1 || !data.areaPlayers[areaPlayerIdx]) continue; // 若該玩家 areaPlayer 找不到，則跳過

                    let inTablePlayer = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(eachPlayerIdInArea);
                    let playerInfo = inTablePlayer.toClientData();

                    let backend = yield self.app.controllers.fishHunterPlayer.getBackendSessions_rpc(inTablePlayer);
                    if (!!backend && !!backend.sessions && backend.sessions.length > 0 && !!backend.sessions[0].get('fireServer')) {
                        // call rpc 取得目前最新餘額
                        let inTable_wallet = yield P.promisify(backend.rpc.getWalletAsync.toServer, backend.rpc.getWalletAsync)(
                            backend.sessions[0].get('fireServer'), inTablePlayer._id, inTablePlayer.gameId, false, null, null
                        );
                        if (inTable_wallet.error == C.OK) {
                            playerInfo.gold = inTable_wallet.data.balance;
                        } else {
                            playerInfo.gold = 0;
                            logger.warn('[sitDown][startGameAsync] inTable getMemWallet fail. playerId: %s, gameId: %s, fireServer: %s, inTable_wallet: ', inTablePlayer._id, inTablePlayer.gameId, backend.sessions[0].get('fireServer'), inTable_wallet);
                        }
                    }

                    let weaponRes = yield self.checkWeapon(data.areaPlayers[areaPlayerIdx]);
                    // 將剩玩家剩餘免費子彈存入玩家gunEx內
                    if (!!weaponRes.jsonFreeBullet) data.areaPlayers[areaPlayerIdx]['jsonFreeBullet'] = weaponRes.jsonFreeBullet;
                    // 存入發射中的特殊武器
                    if (!!weaponRes.shootingInfo) data.areaPlayers[areaPlayerIdx]['gunInfo'] = weaponRes.shootingInfo;

                    // 加入集寶器
                    // let modelCollection = self.app.models.CollectionHistory;
                    // let collectionId = modelCollection.getId(inTablePlayer._id, inTablePlayer.gameId);
                    // let collection = yield modelCollection.findByIdReadOnlyAsync(collectionId);
                    // if (collection)
                    //   data.areaPlayers[i].luckyDraw = {       // 幸運抽獎
                    //     trigger: (collection.count >= collectionDrawConfig.collectionCount),  // 是否觸發
                    //     count: collection.count      // 進度
                    //   };

                    if (playerInfo.gameState === consts.GameState.LEAVING
                        || playerInfo.gameState === consts.GameState.FREE
                        || playerInfo.gameState === consts.GameState.READY) {
                        leavePlayerId.push(playerInfo.id);
                    } else {
                        _areaplayers.push(data.areaPlayers[areaPlayerIdx]);
                        players.push({
                            nickName: playerInfo.nickName,
                            id: playerInfo.id,
                            gold: playerInfo.gold,
                        });
                    }
                }
            }
            data.areaPlayers = _areaplayers;

            data.table = {
                chairIds: table.chairIds,
                level: table.level,
            };
            data.players = players;

            let areaData = data.area;
            data.code = C.OK;  //入桌成功
            data.area = {
                scene: data.area.scene
            }
            if (!!isAreaState && isAreaState.state === consts.AreaState.START) {
                yield self.updateScene(player._id, areaData.id); // 畫面同步
            }
            self.app.controllers.table.pushAsync(table._id, [leavePlayerId], consts.route.client.game.START, data, false);
            const walletResult = yield self.startAndWithdrawalAsync(player, table, areaData.id, fireServerId, betSetting);
            if (!!walletResult) {
                let areaPlayer = yield self.app.models.FishHunterAreaPlayers.findOneAsync({
                    areaId: areaData.id,
                    playerId: player._id
                });
                if (!!areaPlayer) {
                    areaPlayer.denom = walletResult.ratio; // 更新玩家比例
                    yield areaPlayer.saveAsync();
                }
            }
        } else {
            logWarn = true;
            throw (`area initArea fail: ${JSON.stringify(area)}`);
        }
    } catch (err) {
        if (logWarn) {
            logger.warn(`[sitDown][startGameAsync] playerId: ${player._id}, tableId: ${tableId}  err:`, err);
        } else {
            logger.error(`[sitDown][startGameAsync] playerId: ${player._id}, tableId: ${tableId}  err:`, err);
        }
        let msg = {
            code: C.ERROR,
            msg: err.message,
            stack: err.stack,
        };
        this.app.controllers.fishHunterPlayer.pushAsync(player._id, consts.route.client.game.START, msg, false);

    }
});

// proto.isAreaStateAsync = cort(function*(tableId) {
proto.isAreaStateAsync = function (tableId) {
    try {
        if (!_.isString(tableId)) {
            tableId = tableId._id;
        }
        return this.app.controllers.fishHunterCache.findFishAreaByField('tableId', tableId);
    } catch (err) {
        logger.error('[sitDown][isAreaStateAsync] tableId: %s, err: ', tableId, err);
    }
// });
};

// proto.joinAreaAsync = cort(function*(playerId, tableId) {
proto.joinAreaAsync = cort(function* (player, tableId, betSetting) {
    try {
        let table = _.isString(tableId) ? yield this.app.controllers.table.findReadOnlyAsync(tableId) : tableId;
        if (!table) return {error: C.ERROR};

        let self = this;
        let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
        let mArea = self.app.controllers.fishHunterCache.findFishAreaByField('tableId', table._id);
        if (!mArea || mArea.state != consts.AreaState.START) return {error: C.ERROR};

        let mAreaPlayers = [];
        let mAreaPlayer = null;
        let chairIds = table.chairIds;
        let bSuccess = false;

        for (let i = 0; i < chairIds.length; i++) {
            if (!!chairIds[i]) {
                mAreaPlayer = yield modelAreaPlayers.findOneReadOnly({areaId: mArea._id, playerId: chairIds[i]});

                // if (chairIds[i] == playerId && !mAreaPlayer) {
                if (chairIds[i] === player._id && !mAreaPlayer) {
                    // let player = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(chairIds[i]);

                    let area_cache = self.app.controllers.fishHunterCache.findFishArea(mArea._id);
                    area_cache._doc.players.push(player._id); // area cache add player

                    let config = self.app.controllers.fishHunterConfig.getRoomConfig(table.gameId);
                    let room = config.room[table.level] || {};
                    let ratio = room.ratio || 1;

                    mAreaPlayer = new modelAreaPlayers({
                        // _id: uuid(),
                        _id: player._id + '#' + mArea._id,
                        createTime: utils.timeConvert(Date.now(), true),
                        areaId: mArea._id,
                        playerId: chairIds[i],
                        lastFireTime: Date.now(),
                        tableLevel: table.level,
                        gameId: table.gameId,
                        loginIp: (player && player.loginIp) || '',
                        clientType: (player && player.clientType) || '',
                        chairId: i,
                        denom: ratio,
                        dc: player.dc,
                        currency: player.currency || 'CNY',
                        isPromo: player.isPromo
                    });

                    yield mAreaPlayer.saveAsync();
                    bSuccess = true;
                    // logger.warn('joinArea %s join table %s ', playerId, table._id);
                    logger.warn('joinArea %s join table %s ', player._id, table._id);
                } else {
                    logger.info('joinArea %s tableId %s, chairId[%s]: %s, mAreaPlayer: ', player._id, table._id, i, chairIds[i], mAreaPlayer);
                }

                if (!!mAreaPlayer) {
                    if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                        logger.error(`[sitDown][joinAreaAsync] no betSetting! playerId: ${mAreaPlayer.playerId}`);
                        return {error: C.ERROR};
                    }
                    mAreaPlayer = mAreaPlayer.toClientData(betSetting);
                    mAreaPlayers.push({
                        playerId: mAreaPlayer.playerId,
                        cannonCost: mAreaPlayer.cannonCost,
                        cannonLevel: mAreaPlayer.cannonLevel,
                        chairId: mAreaPlayer.chairId,
                        gunEx: mAreaPlayer.gunEx,
                        gunInfo: mAreaPlayer.gunInfo
                    });
                }
            }
        }
        if (!bSuccess) {
            logger.warn('[sitDown][joinAreaAsync] %s joinAreaAsync join FAIL. table: ', player._id, tableId);
            return {error: C.ERROR};
        }

        return {error: null, data: {area: mArea.toClientData(), areaPlayers: mAreaPlayers}};
    } catch (err) {
        logger.error('[sitDown][joinAreaAsync] playerId: %s, tableId: %s, err: ', player._id, tableId, err);
        return {error: C.ERROR};
    }
});

// 同步遊戲畫面
proto.updateScene = cort(function* (playerId, areaId) {
    try {
        let self = this;
        let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
        if (!area)
            return {error: null, data: {}};
        let updateTime = area.updateTime;
        let pauseTime = area.pauseTime;
        let data = {
            updateTime: updateTime,  // area最新時間
            pauseTime: 0,       // 冰凍畫面暫停毫秒數
            fishes: [],  //  存放目前魚場上的魚
            // 當遇到漁場在海浪轉場時，漁場腳本經過時間改為 0
            nowFishTime: area.stage == consts.AreaStage.WAIT ? 0 : _.toNumber(((area.updateTime - area.scenarioTime) / 1000).toFixed(1)), // 腳本已經過多少秒數
        };

        // let fishes = yield self.app.models.FishHunterAreaFishes.findAsync({areaId: area._id});
        let fishes = self.app.controllers.fishHunterArea.getAllFishes(areaId);
        for (let fish of fishes) {
            // 跳過魚已死亡 或 第0隻
            if (fish.born <= 0 || fish.id <= 0) {
                continue;
            }
            // 魚存活時間 > 魚場最新時間 = 魚場上還活著的魚的資訊
            if (fish.born + (fish.alive * 1000) > updateTime) {
                data.fishes.push({
                    type: fish.type,
                    amount: fish.amount,
                    born: fish.born,
                    alive: fish.alive,
                    state: fish.state,
                    path: fish.path,
                    index: fish.index,
                    score: fish.score,
                    id: fish.id,
                });
            }
        }

        const config = self.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);

        // 遊戲暫停時間的毫秒數設定
        const pauseDelayTime = config.scene.PAUSE_SCREEN_TIME_DELAY || 5000;
        if (updateTime - pauseTime < pauseDelayTime) {
            // 計算出剩餘豪秒數
            let remainingPauseTime = pauseDelayTime - (Math.round((updateTime - pauseTime) / 1000)) * 1000;
            data.pauseTime = remainingPauseTime; // 將暫停時間剩餘的毫秒數存入
        }
        self.app.controllers.fishHunterPlayer.pushAsync(playerId, consts.route.client.game.UPDATE_SCENE, data, false);

        return {error: null, data: {}};
    } catch (err) {
        logger.error('[sitDown][updateScene] playerId: %s, areaId: %s, err: ', playerId, areaId, err);
    }
});

// proto.initAreaAsync = cort(function*(playerId, tableId) {
proto.initAreaAsync = cort(function* (player, tableId, betSetting) {
    try {
        const table = _.isString(tableId)
            ? yield this.app.controllers.table.findReadOnlyAsync(tableId)
            : tableId;

        if (!table) {
            throw new Error("TABLE_NOT_FOUND");
        }

        let self = this;
        let modelArea = self.app.models.FishHunterArea;
        let now = Date.now();

        let mArea = new modelArea({
            // _id: uuid(),
            _id: table._id,
            // createTime: utils.timeConvert(now),
            createTime: now,
            updateTime: now,
            tableId: table._id,
            stage: consts.AreaStage.NORMAL,
            sceneTimer: now,
            switchSceneDelayTimer: now,
            state: consts.AreaState.START,
            tableLevel: table.level,
            gameId: table.gameId,
        });

        // TODO ? why it was commented out
        yield mArea.saveAsync();

        /**
         * 若要在 memdb data 內加上不屬於 model 的值，就得多一層 ._doc，未來取值，都要 ._doc
         * 必須把整個 memdb modelArea 加到 cache，joinAreaAsync 用 cache 的資料才能正常 mArea.toClientData()
         */
        mArea._doc['players'] = [];
        self.app.controllers.fishHunterCache.setFishArea(mArea._id, mArea);

        let mAreaPlayers = [];
        let chairIds = table.chairIds;
        let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
        for (let i = 0; i < chairIds.length; i++) {

            const chairId = chairIds[i];
            if (!chairId || chairId !== player._id) {
                continue;
            }

            // let player = yield self.app.controllers.fishHunterPlayer.findReadOnlyAsync(chairIds[i]);

            let area_cache = self.app.controllers.fishHunterCache.findFishArea(mArea._id);
            area_cache._doc.players.push(player._id); // area cache add player

            const config = self.app.controllers.fishHunterConfig.getRoomConfig(table.gameId);
            const room = config.room[table.level] || {};
            const ratio = room.ratio || 1;

            let mAreaPlayer = new modelAreaPlayers({
                // _id: uuid(),
                _id: player._id + '#' + mArea._id,
                createTime: utils.timeConvert(Date.now(), true),
                areaId: mArea._id,
                playerId: chairIds[i],
                lastFireTime: Date.now(),
                tableLevel: table.level,
                gameId: table.gameId,
                loginIp: (player && player.loginIp) || '',
                clientType: (player && player.clientType) || '',
                chairId: i,
                denom: ratio,
                dc: player.dc,
                currency: player.currency || 'CNY',
                isPromo: player.isPromo
            });

            yield mAreaPlayer.saveAsync();
            if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                logger.error(`[sitDown][initAreaAsync] no betSetting! playerId: ${mAreaPlayer.playerId}`);
                return {error: C.ERROR};
            }
            mAreaPlayer = mAreaPlayer.toClientData(betSetting);
            mAreaPlayers.push({
                playerId: mAreaPlayer.playerId,
                cannonCost: mAreaPlayer.cannonCost,
                cannonLevel: mAreaPlayer.cannonLevel,
                chairId: mAreaPlayer.chairId,
                gunEx: mAreaPlayer.gunEx,
                gunInfo: mAreaPlayer.gunInfo
            });

            logger.warn('initArea %s join table %s ', player._id, table._id);

        }

        // 給特殊封包碰撞的魚(找不到server產生的魚時)
        let opts = {
            id: 0,
            type: 'Fish_000',
            amount: 1,
            born: Date.now(),
            alive: 20,
            state: 'flock',
            path: 'FS_1-0_n15|bz_id_36',
            index: 0,
            score: 2
        }
        opts._id = mArea._id + opts.id;
        opts.areaId = mArea._id;
        // let temp = new self.app.models.FishHunterAreaFishes(opts);
        // yield temp.saveAsync();
        const fishTypeConfig = self.app.controllers.fishHunterConfig.getFishTypeConfig(table.gameId);
        self.app.controllers.fishHunterArea.insertAreaFish(mArea._id, [opts], fishTypeConfig, table.gameId);

        return {error: null, data: {area: mArea.toClientData(), areaPlayers: mAreaPlayers}};
    } catch (err) {
        // logger.error('[sitDown][initAreaAsync] playerId: %s, table: %s, err: ', playerId, JSON.stringify(table), err);
        logger.error('[sitDown][initAreaAsync] playerId: %s, table: %s, err: ', player._id, JSON.stringify(table), err);
    }
});

//joinArea 失敗補救
proto.ReJoinArea = cort(function* (player, table, betSetting) {
    try {
        let self = this;
        let area = {};
        let ret = null;
        let roomControl = this.app.controllers.room;
        let retryCount = self.app.controllers.fishHunterConfig.getParamDefinConfig().RetryJoinAreaCount;

        logger.info(`[sitDown][ReJoinArea] begin. serverId: ${self.app.getServerId()}, playerId: ${player._id}, table: ${JSON.stringify(table)}}`);

        //尋找桌iCurCount次
        for (let iCurCount = 1; iCurCount <= retryCount; iCurCount++) {
            logger.info(`[sitDown][ReJoinArea] reJoin before. count: ${iCurCount}, playerId: ${player._id}, table: ${JSON.stringify(table)}}`);

            //離桌動作
            // self.app.tableSearcher.deleteAvailTable(table._id, player.gameId);
            let delTable = self.app.tableSearcher.deleteAvailTable(table._id, player.gameId);
            logger.info(`[sitDown][ReJoinArea] reJoin count: ${iCurCount}, playerId: ${player._id}, tableId: ${table._id}, delTable:`, delTable);
            yield self.app.controllers.table.quitAsync(table._id, player._id, null);

            //加入別桌或建立新桌
            table = yield roomControl.searchAndJoinAsync(player._id, player.connectorId, player.gameId, {
                level: table.level,
                currency: player.currency,
                betSettingUsedCid: betSetting.usedCid
            });
            //fish_hunter_player更新tableId
            yield self.app.memdb.goose.transactionAsync(function () {
                return self.app.controllers.fishHunterPlayer.internalUpdateAsync(player._id, {tableId: table._id});
            }, self.app.getServerId());

            logger.info(`[sitDown][ReJoinArea] reJoin after. count: ${iCurCount}, playerId: ${player._id}, table: ${JSON.stringify(table)}}`);

            // let isAreaState = yield self.isAreaStateAsync(table._id); //判斷桌id是否在area裡
            let isAreaState = self.isAreaStateAsync(table._id); //判斷桌id是否在area裡
            if (!!isAreaState && isAreaState.state === consts.AreaState.START) {
                //玩家加入到fish_hunter_area_players
                // area = yield self.joinAreaAsync(player._id,table);
                area = yield self.joinAreaAsync(player, table, betSetting);
                // if (!area.error) {
                //   yield this.updateScene(player, area._id); // 畫面同步
                // }
            } else if (!!isAreaState) {
                continue;
            } else {
                //建立fish_hunter_area、玩家加入到fish_hunter_area_players
                // area = yield self.initAreaAsync(player._id, table);
                area = yield self.initAreaAsync(player, table, betSetting);
            }

            if (!!area.error) {
                continue;
            }

            return {
                area: area,
                table: table
            }; //成功入桌或建桌
        }

        //retryCount次都沒成功入桌，或也沒建立桌
        area.error = C.ERROR;
        ret = {
            area: area,
            table: table
        };
        return ret;
    } catch (err) {
        logger.error('[sitDown][ReJoinArea] player: %s, table: %s, err: ', JSON.stringify(player), JSON.stringify(table), err);
    }
});


proto.startAndWithdrawalAsync = cort(function* (player, table, areaId, fireServerId, betSetting) {
    try {
        let self = this;
        switch (player.accountState) {
            case consts.AccountState.SUSPEND:
                self.app.controllers.debug.info('warn', 'startAndWithdrawalAsync', {
                    playerId: player._id,
                    userName: player.nickName,
                    reason: '拒絕轉帳: 玩家帳號被停用, AccountState: ' + player.accountState,
                });
                return null;
            case consts.AccountState.FREEZE:
                this.app.controllers.debug.info('warn', 'startAndWithdrawalAsync', {
                    playerId: player._id,
                    userName: player.nickName,
                    reason: '拒絕轉帳: 玩家帳號被凍結, AccountState: ' + player.accountState,
                });
                return null;
        }

        if (!fireServerId) {
            return self.handlerSessionClose(player, areaId, '[startAndWithdrawalAsync] Not find fireServerId.');
        } else {
            // 二次檢查玩家在不在線上
            let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'startAndWithdrawalAsync');
            if (!sessionId) return self.handlerSessionClose(player, areaId, '[startAndWithdrawalAsync] Not find sessionId.');
        }

        // return self.app.memdb.goose.transactionAsync(cort(function*() {
        //     let tokens = yield self.app.models.GameTokens.findOneAsync({playerId: player._id, gameId: table.gameId});
        let tokensDao = self.app.controllers.daoMgr.getGameTokenDao();
        let tokens = yield tokensDao.initAsync(player._id, table.gameId, player.isSingleWallet, player.currency);
        if (!!tokens) {
            //player.isSingleWallet !== consts.walletType.multipleWallet &&
            let backend = yield self.app.controllers.fishHunterPlayer.getBackendSessions_rpc(player);
            if (!!backend && !!fireServerId) {
                yield P.promisify(backend.rpc.getWalletAsync.toServer, backend.rpc.getWalletAsync)(fireServerId, player._id, player.gameId, false, tokens.wagerId, betSetting); // init memWallet
            }

            let reData = {
                creditAmount: 0,
                amount: 0,
                playerId: player._id,
            };

            switch (player.isSingleWallet) {
                // 多錢包
                case consts.walletType.multipleWallet:
                    // 不需轉帳
                    if (tokens.balance > 0) {
                        // tokens.oneAreaExchange = tokens.amount;
                        // yield tokens.saveAsync();
                        let walletInfo = tokens.toClientData();
                        walletInfo.creditAmount = tokens.balance; // utils.number.add(tokens.quota, tokens.balance);
                        walletInfo.delta = 0; //tokens.amount;
                        reData.creditAmount = walletInfo.creditAmount;
                        reData.amount = tokens.tokenAmount;
                        self.app.controllers.table.pushAsync(table._id, null, consts.route.client.game.UPDATE_WALLET, reData, false);
                        return walletInfo;
                    }
                    // forceExchange=true
                    else if (tokens.balance == 0) {
                        let config = self.app.controllers.fishHunterConfig.getRoomConfig(table.gameId);
                        let wallet = config.wallet[table.level] || {};
                        let room = config.room[table.level] || {};
                        let amount = wallet.min || 0;
                        let ratio = room.ratio || 1;
                        let allIn = true;
                        let ret = yield self.app.controllers.fishHunterPlayer.accountToWalletAsync(player, amount, ratio, 'startGameAsync', allIn, fireServerId);
                        if (!ret.code) {
                            reData.creditAmount = ret.data.creditAmount;
                            reData.amount = ret.data.amount;
                            backend.rpc.onExchange.toServer(fireServerId, player._id, player.gameId, betSetting, (err, rsp) => {
                                logger.info(`startAndWithdrawalAsync.rpc.onExchange playerId: ${player._id}, rsp:`, rsp);
                            });
                            self.app.controllers.table.pushAsync(table._id, null, consts.route.client.game.UPDATE_WALLET, reData, false);
                            return ret.data;
                        } else {
                            if (player.demo !== consts.demoType.demo && ret.return_mysql) {
                                logger.info(`[sitDown][startAndWithdrawalAsync] amount return mysql. playerId: ${player._id}, amount: ${ret.amount}, dc: ${player.dc}`);
                                // 正式or測試帳號 // 轉帳失敗把錢轉回 MySQL
                                let account = yield self.app.controllers.account.modifyCreditByPlayerIdAsync(player, Math.abs(ret.amount), player.currency, 'startAndWithdrawalAsync', false, allIn, ret.logQuotaId);
                                if (!account || account.error) logger.error('[sitDown][startAndWithdrawalAsync] 轉帳失敗: 要把錢轉回 MySQL 時還是失敗, playerId: %s, amount: %s, logQuotaId: %s, errorcode: %s, player: %s', player._id, Math.abs(ret.amount), ret.logQuotaId, account.error, JSON.stringify(player));
                            }
                            return null;
                        }
                    }
                    logger.error('[sitDown][startAndWithdrawalAsync] err playerId: %s, tokens.amount < 0, tokens.amount: ', player._id, tokens.amount);
                    return null;
                // 單錢包(一般) & 單錢包(betAndWin)
                case consts.walletType.singleWallet:
                case consts.walletType.singleBetAndWin:
                case consts.walletType.singleBetAndWinDelay:
                    break;
                // 假多錢包(一般) or 假多錢包(betAndWin)
                default:
                    // 總餘額 = 彈夾餘額 + 平台餘額;
                    //tokens.amount = utils.number.add(tokens.amount, tokens.quota);

                    if (typeof player.isSingleWallet.reload == 'undefined') {
                        // AUTO
                        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                            logger.error(`[sitDown][startAndWithdrawalAsync] no betSetting! playerId: ${player._id}`);
                            return null;
                        }
                        // let currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfigByDC(player.dc);
                        // if (!currencyConfig) currencyConfig = self.app.controllers.fishHunterConfig.getCurrencyConfig();
                        // let costList = currencyConfig[(player.currency)].cannon.cost[player.tableLevel];
                        let costList = betSetting.info.levels[player.tableLevel].cannon.cost;
                        // 彈夾額度 clip 為該遊戲房中最大投注值的 reloadMultiple 倍
                        let clip = utils.number.multiply(costList[costList.length - 1], player.isSingleWallet.reloadMultiple);
                        if (player.isSingleWallet.clip == 'AUTO' || _.isNumber(player.isSingleWallet.clip))
                            player.isSingleWallet.clip = clip;
                        else
                            player.isSingleWallet.clip = consts.walletType.singleBetAndWin + '-' + clip;

                        player.markModified('isSingleWallet');
                        yield player.saveAsync();
                    }
                    break;
            }

            reData.amount = tokens.tokenAmount;
            self.app.controllers.table.pushAsync(table._id, null, consts.route.client.game.UPDATE_WALLET, reData, false);
            return {ratio: tokens.ratio};
        }
        logger.error('startAndWithdrawalAsync playerId: %s, tokens not exist: ', player._id, tokens);
        return null;
        // }), self.app.getServerId())
        // .catch(err => {
        //     logger.error('[sitDown][startAndWithdrawalAsync][transactionAsync][catch] err: ', err);
        // });
    } catch (err) {
        logger.error('[sitDown][startAndWithdrawalAsync] playerId: %s, err: ', player._id, err);
        return null;
    }
});

proto.checkWeapon = cort(function* (areaPlayer) {
    try {
        let data = {
            jsonFreeBullet: null,
            shootingInfo: null,
        };

        // 檢查 bazooka 各個成本剩餘子彈數
        if (typeof areaPlayer.gunEx['bazooka'] !== 'undefined' && areaPlayer.gunEx.bazooka > 0) {
            data.jsonFreeBullet = [];
            for (let item of areaPlayer.gunInfo) {
                if (item.type == consts.FishType.BAZOOKA) {
                    data.jsonFreeBullet.push({
                        cost: item.cost,
                        alive: item.alive,
                    });
                }
            }
        }

        // 檢查是否有發射中的特殊武器(畫面同步用)
        if (typeof areaPlayer.gunInfo == 'undefined') return data;
        const count = areaPlayer.gunInfo.length;
        if (count == 0) {
            return data;
        } else {
            data.shootingInfo = {};
            for (let i = 0; i < count; i++) {
                if (areaPlayer.gunInfo[i].bulletId > 0) {
                    data.shootingInfo = {
                        bulletId: areaPlayer.gunInfo[i].bulletId,
                        type: areaPlayer.gunInfo[i].type
                    }
                    break;
                }
            }
            return data;
        }
    } catch (err) {
        logger.error('[sitDown][checkWeapon] areaPlayer: %s, err: ', JSON.stringify(areaPlayer), err);
    }
});

proto.handlerSessionClose = async function (player, areaId, reason) {
    try {
        let self = this;
        // 嘗試踢玩家下線看看
        await self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.ERROR);
        if (!areaId) {
            logger.info('[sitDown][handlerSessionClose] 1. playerId: %s, areaId: %s, reason: %s', player._id, areaId, reason);
            return null;
        }

        // 處理漁場 & areaPlayer
        // 清除魚場 players 正在離桌的此位玩家
        await self.app.controllers.standUp.clearAreaPlayer(areaId, player._id);

        let areaPlayer = await self.app.models.FishHunterAreaPlayers.findOneAsync({playerId: player._id, areaId});
        if (!!areaPlayer) await areaPlayer.removeAsync(); // 有資料則刪除，否則會殘留
        logger.info('[sitDown][handlerSessionClose] 2. playerId: %s, areaId: %s, reason: %s', player._id, areaId, reason);
        return null;
    } catch (err) {
        logger.error('[sitDown][handlerSessionClose] playerId: %s, areaId: %s, err: ', player._id, areaId, err);
        return null;
    }
};
