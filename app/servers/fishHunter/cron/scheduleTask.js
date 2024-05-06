let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
const apiCode = require('../../../expressRouter/apiServerStatus');
let consts = require('../../../../share/consts');
let utils = require('../../../utils/utils');
const uuid = require('uuid/v1');
let util = require('util');
let controller = require('../../../controllers/fishHunterCache');
let fishHunterCache;
let CRON_DOING_EVENT = {};
let m_bShowTimeGap = false;

let Cron = function (app) {
    this.startupTime = Date.now();
    this.app = app;

    if (this.app.get('env') == 'development')
        m_bShowTimeGap = true;
};

module.exports = function (app) {
    fishHunterCache = new controller(app);
    fishHunterCache.start();

    return new Cron(app);
};

let proto = Cron.prototype;
let cort = P.coroutine;

setCRON_DOING_EVENT = function (key, value) {
    try {
        CRON_DOING_EVENT[key] = value;
    } catch (err) {
        logger.error('[fishHunter][setCRON_DOING_EVENT][catch] err:', err);
    }
}
getCRON_DOING_EVENT = function (key) {
    try {
        return CRON_DOING_EVENT[key];
    } catch (err) {
        logger.error('[fishHunter][getCRON_DOING_EVENT][catch] err:', err);
    }
}

proto.timerLoop = cort(function* () {
    try {
        if (getCRON_DOING_EVENT("timerLoop")) {
            // logger.warn('[fishHunter][timerLoop] return by CRON_DOING_EVENT["timerLoop"] = ', getCRON_DOING_EVENT("timerLoop"));
            // return;
        }
        setCRON_DOING_EVENT("timerLoop", true);

        let self = this;
        yield self._refreshArea();

        setCRON_DOING_EVENT("timerLoop", false);
    } catch (err) {
        logger.error('[fishHunter][timerLoop][_refreshArea][catch] err:', err);
    }
});

proto._refreshArea = cort(function* () {

    let self = this;
    let controller = this.app.controllers.fishHunterArea;
    let activeAreas = self.app.controllers.fishHunterCache.findAllFishArea();

    // 整點印一下area數量
    let now = new Date();
    if (now.getMinutes() === 0 && now.getSeconds() === 0) {
        if (!!activeAreas) {
            logger.info('[fishHunter][scheduleTask][_refreshArea] %s before activeAreas.length = ',
                self.app.getServerId(), Object.keys(activeAreas).length
            );
        }
    }

    for (let i in activeAreas) {

        try {
            let area = activeAreas[i];
            // TODO why there is null area dev remove
            if (!area) {
                continue;
            }
            switch (area.state) {
                case consts.AreaState.END:
                    //處理結束的Area
                    logger.info('[fishHunter][scheduleTask][_refreshArea] delFishArea area:', area);
                    self.app.controllers.fishHunterCache.delFishArea(area._id);
                    yield controller.removeDeactiveAreaFishes(area, true);

                    break;
                case consts.AreaState.START:
                    if (area.updateTime - area.createTime > 300000) { // 漁場開始超過 5 分鐘再開始檢查人數
                        // 漁場沒人關閉漁場
                        if (area._doc.players.length <= 0) {
                            area.state = consts.AreaState.END;
                        }
                    }

                    //處理Area的更新
                    if (area.state !== consts.AreaState.END) {
                        yield controller.refreshAreaFrameAsync(area);
                    }

                    break;
            }
        } catch (ex) {
            logger.error('[fishHunter][scheduleTask][_refreshArea][catch] inner err:', ex);
        }
    }

});


//背景程式 - 每分鐘檢查閒置5分鐘沒押注的玩家，再踢人
proto.ClearIdlePlayer = cort(function* () {
    /*
    1.取得activeAreas
    2.依activeAreas.areaId 找所有正在跑的Area魚場
    3.魚場每個player都查詢一下他的lastFireTime最後發射子彈的時間
    4. lastFireTime最後發射子彈的時間 比5分鐘之前的時間還小 代表很久沒射子彈了=>列入嫌犯名單target_players內
    5. 針對嫌犯名單target_players內所有player都去做踢人的動作 kicksync
     */
    try {
        if (getCRON_DOING_EVENT("ClearIdlePlayer")) {
            logger.warn('[fishHunter][ClearIdlePlayer] return by CRON_DOING_EVENT["ClearIdlePlayer"] = ', getCRON_DOING_EVENT("ClearIdlePlayer"));
            // return;
        }
        setCRON_DOING_EVENT("ClearIdlePlayer", true);

        let self = this;
        let timeOutFire = Date.now() - self.app.controllers.fishHunterConfig.getParamDefinConfig().ClearIdlePlayerTime * 60 * 1000;
        let target_players = [];

        //1.取得activeAreas
        let AreaPlayers;
        let areas = self.app.controllers.fishHunterCache.findAllFishArea();
        let gameTokensDao = self.app.controllers.daoMgr.getGameTokenDao();

        //2.依activeAreas.areaId 去 fish_hunter_area_players.areaId找出players集合
        yield self.app.memdb.goose.transactionAsync(cort(function* () {
            for (let i in areas) {
                // AreaPlayers = yield self.app.models.FishHunterAreaPlayers.findAsync({'areaId': areas[i]._id});
                if (!areas[i]) {
                    continue;
                }

                AreaPlayers = yield self.app.models.FishHunterAreaPlayers.findReadOnlyAsync({'areaId': areas[i]._id});
                for (let player of AreaPlayers) {
                    let tokens = yield gameTokensDao.findOneAsync(player.playerId, player.gameId, true);
                    if (!!tokens && tokens.lastFireTime < timeOutFire) {//lastFireTime最後發射子彈的時間比timeOutFire小的才是兇手的才列入target_players中
                        target_players.push({
                            playerId: player.playerId,
                            gameId: player.gameId,
                            loginIp: player.loginIp,
                            lastFireTime: player.lastFireTime,
                            areaId: areas[i]._id
                        });
                    }
                }
            }
        }), self.app.getServerId());

        if (target_players.length > 0) { //所有超過5分鐘沒有更新lastFireTime的玩家 =>一次呼叫踢人function

            for (let player of target_players) {
                // 找自己 fishHunter server 快取的線上玩家
                let onlinePlayer = self.app.controllers.fishHunterCache.getOnlinePlayers(player.playerId);

                if (!onlinePlayer) {
                    // cache不在這台server
                    logger.info(`清除殘留cache(cache不在這台server) playerId: ${player.playerId}, areaId: ${player.areaId}, serverId: ${self.app.getServerId()}, onlinePlayer:`, onlinePlayer);
                    // 清殘留：需直接刪除areaPlayer
                    yield self.app.controllers.daoMgr.getAreaPlayerDao().removeAsync(player.areaId, player.playerId, self.app.getServerId()); // 刪除 areaPlayer

                    // 清殘留：需刪除 area._doc.players
                    yield self.app.controllers.standUp.clearAreaPlayer(player.areaId, player.playerId);
                } else {
                    // 有的話，檢查session
                    let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId({
                        _id: player.playerId,
                        connectorId: onlinePlayer.connectorId
                    }, 'ClearIdlePlayer');
                    if (!sessionId) {
                        logger.info(`清除殘留cache(cache在這台server但sessionId不存在) playerId: ${player.playerId}, areaId: ${player.areaId}, serverId: ${self.app.getServerId()}`);
                        // 清殘留：需直接刪除areaPlayer
                        yield self.app.controllers.daoMgr.getAreaPlayerDao().removeAsync(player.areaId, player.playerId, self.app.getServerId()); // 刪除 areaPlayer

                        // 清殘留：需刪除 area._doc.players
                        yield self.app.controllers.standUp.clearAreaPlayer(player.areaId, player.playerId);
                    } else {
                        // 正常踢出流程：
                        self.app.controllers.fishHunterPlayer.kickPlayer(null, player.playerId, player.gameId, player.loginIp, player.lastFireTime, C.PLAYER_IDLE_TOO_LONG_IN_ROOM);
                    }
                }
            }
        }

        setCRON_DOING_EVENT("ClearIdlePlayer", false);
    } catch (err) {
        logger.error('[scheduleTask][ClearIdlePlayer] err: ', err);
    }
});

// 清除在大廳閒置超過三分鐘的玩家
proto.ClearLobbyIdlePlayer = cort(function* () {
    try {
        if (getCRON_DOING_EVENT("ClearLobbyIdlePlayer")) {
            logger.warn('[fishHunter][ClearLobbyIdlePlayer] return by CRON_DOING_EVENT["ClearLobbyIdlePlayer"] = ', getCRON_DOING_EVENT("ClearLobbyIdlePlayer"));
            // return;
        }
        setCRON_DOING_EVENT("ClearLobbyIdlePlayer", true);

        let self = this;
        let players = self.app.controllers.fishHunterCache.getOnlinePlayers();

        if (players) {
            let time = Date.now() - (self.app.controllers.fishHunterConfig.getParamDefinConfig().ClearLobbyPlayerTime * 60 * 1000);

            yield self.app.memdb.goose.transactionAsync(cort(function* () {
                for (let id in players) {
                    const player = players[id];
                    if (!player) {
                        continue;
                    }
                    if (players[id].gameState === consts.GameState.FREE && players[id].updateTime <= time) {
                        // 將閒置超過時間(3min)的玩家踢下線
                        self.app.controllers.fishHunterPlayer.kickPlayer(players[id].connectorId, id, players[id].gameId, players[id].loginIp, players[id].updateTime, C.PLAYER_IDLE_TOO_LONG_IN_LOBBY);
                    }
                }
            }), self.app.getServerId());
        }

        setCRON_DOING_EVENT("ClearLobbyIdlePlayer", false);
    } catch (err) {
        logger.error('[scheduleTask][ClearLobbyIdlePlayer] err: ', err);
    }
});

// 限時踢特定玩家
proto.SpecialKickPlayer = cort(function* () {
    try {
        if (getCRON_DOING_EVENT("SpecialKickPlayer")) {
            logger.warn('[fishHunter][SpecialKickPlayer] return by CRON_DOING_EVENT["SpecialKickPlayer"] = ', getCRON_DOING_EVENT("SpecialKickPlayer"));
            // return;
        }
        setCRON_DOING_EVENT("SpecialKickPlayer", true);

        let dcs = ['SW'];
        let self = this;
        let players = self.app.controllers.fishHunterCache.getOnlinePlayers();

        if (players) {
            let time = Date.now() - (self.app.controllers.fishHunterConfig.getParamDefinConfig().SpecialKickTime * 60 * 1000);
            yield self.app.memdb.goose.transactionAsync(cort(function* () {
                for (let id in players) {
                    const player = players[id];
                    if (!player) {
                        continue;
                    }
                    if (players[id].lastLoginTime <= time) {
                        // 將特定的玩家踢下線
                        if (dcs.indexOf(players[id].dc) > -1) {
                            self.app.controllers.fishHunterPlayer.kickPlayer(players[id].connectorId, id, players[id].gameId, players[id].loginIp, players[id].updateTime);
                        }
                    }
                }
            }), self.app.getServerId());
        }

        setCRON_DOING_EVENT("SpecialKickPlayer", false);
    } catch (err) {
        logger.error('[scheduleTask][SpecialKickPlayer] err: ', err);
    }
});

// 單錢包玩家定時更新
proto.updateSingleWalletBalance = cort(function* () {
    try {
        if (getCRON_DOING_EVENT("updateSingleWalletBalance")) {
            logger.warn('[fishHunter][updateSingleWalletBalance] return by CRON_DOING_EVENT["updateSingleWalletBalance"] = ', getCRON_DOING_EVENT("updateSingleWalletBalance"));
            // return;
        }
        setCRON_DOING_EVENT("updateSingleWalletBalance", true);

        let self = this;
        let players = self.app.controllers.fishHunterCache.getOnlinePlayers();
        if (players) {
            let now = Date.now();
            let checkTime = self.app.controllers.fishHunterConfig.getParamDefinConfig().updateSingleWalletBalanceTime * 1000;

            for (let id in players) {
                let playerCache = players[id];
                // TODO dev remove, why there is null playerCache?
                if (!playerCache) {
                    continue;
                }
                if (playerCache.gameState === consts.GameState.FREE
                    && playerCache.isSingleWallet !== consts.walletType.multipleWallet
                    && now - playerCache.updateSingleWalletBalanceTime > checkTime) {
                    let sessionId = yield self.app.controllers.fishHunterPlayer.getPlayerSessionId({
                        _id: id,
                        connectorId: playerCache.connectorId
                    }, 'updateSingleWalletBalance');
                    // 玩家若已斷線 就不執行更新餘額
                    if (sessionId !== null) {
                        this.doUpdateSingleWalletBalance(id, playerCache, now);
                    }
                }
            }
        }

        setCRON_DOING_EVENT("updateSingleWalletBalance", false);
    } catch (err) {
        logger.error('[scheduleTask][updateSingleWalletBalance] err: ', err);
    }
});

proto.doUpdateSingleWalletBalance = cort(function* (id, playerCache, now) {
    let self = this;
    let player, tokens;
    try {
        // 設定新時間
        playerCache.updateSingleWalletBalanceTime = now;

        // 未回傳前無法再次呼叫
        let checkRequest = self.app.controllers.fishHunterCache.getApiAuthInfo(id, playerCache.gameId, consts.APIMethod.fetchBalance);
        if (checkRequest) {
            logger.warn('[scheduleTask][doUpdateSingleWalletBalance] player: %s, gameId: %s, getApiAuthInfo return by err:', id, playerCache.gameId, C.API_AUTHING);
            return;
        }

        player = yield self.app.memdb.goose.transactionAsync(function () {
            return self.app.controllers.fishHunterPlayer.findReadOnlyAsync(id);
        }, self.app.getServerId());
        if (!player) {
            logger.error('[scheduleTask][doUpdateSingleWalletBalance] 從cache中的 id: %s 找不到player', id);
            return;
        }

        // 遊戲中，上次betAndWin時間低於五秒內 或 五秒內有發射新子彈，就不更新餘額
        let updateSingleBetAndWinDelayTime = self.app.controllers.fishHunterConfig.getParamDefinConfig().updateSingleBetAndWinDelayTime * 1000;
        if (playerCache.gameState == consts.GameState.PLAYING)
            if (now - playerCache.updateSingleBetAndWinDelayTime < updateSingleBetAndWinDelayTime
                || now - player.lastFireTime < updateSingleBetAndWinDelayTime)
                return;

        self.app.controllers.fishHunterCache.setApiAuthInfo(player._id, player.gameId, consts.APIMethod.fetchBalance);

        // 域名設定使用的dc
        player['dsUseDc'] = playerCache.dsUseDc;
        // 送api
        let featchBalanceRes = yield self.app.controllers.fishHunterPlayer.callFetchBalance(player);
        self.app.controllers.fishHunterCache.delApiAuthInfo(player._id, player.gameId, consts.APIMethod.fetchBalance);
        if (!featchBalanceRes || featchBalanceRes.code !== C.OK) {
            if (featchBalanceRes && featchBalanceRes.hasOwnProperty('apiErrorCode')) {
                // 以下錯誤不印 error
                if (featchBalanceRes.apiErrorCode == C.API_RETURN_TOKEN_EXPIRED || // Token 過期
                    featchBalanceRes.apiErrorCode == C.CUSTOMER_IN_MAINTENANCE_MODE || // 介接方維護
                    featchBalanceRes.apiErrorCode == C.API_AUTH_TIME_OUT // API time out
                ) return;
            }
            logger.error('[scheduleTask][doUpdateSingleWalletBalance] Fail, callFetchBalance:', featchBalanceRes);
            return;
        }

        let gameTokensDao = self.app.controllers.daoMgr.getGameTokenDao();
        tokens = yield gameTokensDao.findOneAsync(player._id, player.gameId, true);
        if (!tokens) {
            logger.error('[standUp][doUpdateSingleWalletBalance] err: tokens: %s, playerId: %s, gameId: %s', tokens, player._id, player.gameId);
            return;
        }

        // 送更新餘額給前端
        yield self.updateAmountToClient(player, playerCache, tokens, featchBalanceRes.amount);
    } catch (err) {
        logger.error('[scheduleTask][doUpdateSingleWalletBalance] id = %s, err: ', id, err);
    }
})

proto.updateAmountToClient = cort(function* (player, playerCache, tokens, quota) {
    try {

        if (!_.isNumber(quota)) {
            return;
        }

        let self = this;
        let data;
        let creditAmount = tokens.calcBalance(quota);
        let gameTokensDao = self.app.controllers.daoMgr.getGameTokenDao();

        if (playerCache.gameState === consts.GameState.FREE) {

            let balance = tokens.balance;
            if (creditAmount != balance) {
                logger.warn(`fishHunter.updateAmountToClient playerId:${player._id}-gameId:${player.gameId}
          remoteBalance:${creditAmount}-localBalance:${balance}-quota:${quota}
          updateQuotaAsync
        `);
                tokens = yield gameTokensDao.updateQuotaAsync(player._id, player.gameId, quota);

                if (!tokens) {
                    logger.warn(`fishHunter.updateAmountToClient playerId:${player._id}-gameId:${player.gameId}
          remoteBalance:${creditAmount}-localBalance:${balance}-quota:${quota}
          updateQuotaAsync error
        `);

                    return;
                }
            }

            // 大廳送UPDATE_WALLET
            data = {
                creditAmount: tokens.balance,
                amount: 0,
                playerId: player._id,
            };
            self.app.controllers.fishHunterPlayer.pushAsync(player._id, consts.route.client.game.UPDATE_WALLET, data, false);
        } else {
            // 遊戲中送UPDATE_BALANCE
            // data = {
            //   pid: player._id,
            //   balance: creditAmount
            // };
            // self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, data, false);
        }
    } catch (err) {
        logger.error('[scheduleTask][updateAmountToClient] err: ', err);
    }
});


/////风控timer

proto.rcTimerLoop = cort(function* () {
    try {
        if (getCRON_DOING_EVENT("rcTimerLoop")) {
            logger.warn('[fishHunter][rcTimerLoop] return by CRON_DOING_EVENT["rcTimerLoop"] = ', getCRON_DOING_EVENT("rcTimerLoop"));
            // return;
        }
        setCRON_DOING_EVENT("rcTimerLoop", true);

        yield this._readFishAlgArgsFromDB();

        yield this._readFishLimitFromDB();

        setCRON_DOING_EVENT("rcTimerLoop", false);
    } catch (err) {
        logger.error('[fishHunter][scheduleTask][rcTimerLoop] err: ', err);
    }
});
//讀RTP Controller 調整控制後的等級
proto._readFishAlgArgsFromDB = function () {
    let self = this;

    return this.app.memdb.goose.transactionAsync(cort(function* () {
        let cache = self.app.controllers.fishHunterCache;
        let modelScoreInOut = self.app.models.FishHunterScoreInOut;
        let gameIds = self.app.controllers.fishHunterCache.getFishAlgKeys();
        if (!!gameIds) {
            for (let i in gameIds) {
                const gameId = gameIds[i];
                if (!gameId) {
                    continue;
                }
                let rec = yield modelScoreInOut.findOneReadOnlyAsync({gameId: gameId});
                if (!!rec) {
                    logger.debug('_readFishAlgArgsFromDB ', gameId, ' ', rec.levels);
                    for (let room in rec.levels) {
                        cache.setFishAlgArgs(gameId, room, rec.levels[room]);
                    }
                }
            }
        }
    }), self.app.getServerId())
        .catch(err => {
            logger.error('[fishHunter][scheduleTask][_readFishAlgArgsFromDB] err: ', err);
        });
}
//讀RTP Controller 調整 限制線
proto._readFishLimitFromDB = function () {
    let self = this;

    return this.app.memdb.goose.transactionAsync(cort(function* () {
        let cache = self.app.controllers.fishHunterCache;
        let modelScoreInOut = self.app.models.FishHunterScoreInOut;
        let gameIds = self.app.controllers.fishHunterCache.getFishRTPKeys();
        if (!!gameIds) {
            for (let i in gameIds) {
                const gameId = gameIds[i];
                if (!gameId) {
                    continue;
                }
                let rec = yield modelScoreInOut.findOneReadOnlyAsync({gameId: gameId});
                if (!!rec) {
                    logger.debug('_readFishLimitFromDB ', gameId, ' ', rec.checkRTP.global);
                    for (let room in rec.levels) {
                        cache.setFishRTP(gameId, room, rec.checkRTP.global);
                    }
                }
            }
        }
    }), self.app.getServerId())
        .catch(err => {
            logger.error('[fishHunter][scheduleTask][_readFishLimitFromDB] err: ', err);
        });
}

// 指定玩家限時回應心跳
proto.SpecialKeepAlive = cort(function* () {
    try {
        if (getCRON_DOING_EVENT("SpecialKeepAlive")) {
            logger.warn('[fishHunter][SpecialKeepAlive] return by CRON_DOING_EVENT["SpecialKeepAlive"] = ', getCRON_DOING_EVENT("SpecialKeepAlive"));
            // return;
        }
        setCRON_DOING_EVENT("SpecialKeepAlive", true);

        const KEEP_ALIVE_TIME = 5 * 60 * 1000;
        let dcs = ['SW,IG88'];
        let self = this;
        let players = self.app.controllers.fishHunterCache.getOnlinePlayers();

        if (players) {
            let time = Date.now() - KEEP_ALIVE_TIME;
            for (let id in players) {
                let playerCache = players[id];
                if (!playerCache) {
                    continue;
                }
                if (dcs.indexOf(playerCache.dc) > -1 && playerCache.specialKeepAliveTime <= time) {
                    players[id].specialKeepAliveTime = Date.now();
                    let player = yield self.app.memdb.goose.transactionAsync(function () {
                        return self.app.controllers.fishHunterPlayer.findReadOnlyAsync(id);
                    }, self.app.getServerId());
                    if (!player) {
                        logger.error('[scheduleTask][SpecialKeepAlive] 從cache中的 id: %s 找不到player', id);
                        continue;
                    }

                    self.app.controllers.fishHunterCache.setApiAuthInfo(player._id, player.gameId, consts.APIMethod.keepAlive);

                    // 域名設定使用的dc
                    player['dsUseDc'] = playerCache.dsUseDc;
                    // 送api
                    let callKeepAliveRes = yield self.app.controllers.fishHunterPlayer.callKeepAlive(player);
                    self.app.controllers.fishHunterCache.delApiAuthInfo(player._id, player.gameId, consts.APIMethod.keepAlive);
                    if (!callKeepAliveRes || callKeepAliveRes.code !== C.OK) {
                        if (callKeepAliveRes.hasOwnProperty('apiErrorCode') && callKeepAliveRes.apiErrorCode == C.API_RETURN_TOKEN_EXPIRED) {
                            continue; // Token 過期不印 error.
                        }
                        logger.warn('[scheduleTask][SpecialKeepAlive] callKeepAliveRes err:', callKeepAliveRes.code);
                        continue;
                    }

                }
            }
        }

        setCRON_DOING_EVENT("SpecialKeepAlive", false);
    } catch (err) {
        logger.error('[scheduleTask][SpecialKickPlayer] err: ', err);
    }
});

proto.handleCronClearCache = async function () {
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) dt = Date.now();

    let self = this;
    let playerId, gameId, connectorId, count;
    let notClearList = [];
    try {

        if (getCRON_DOING_EVENT("handleCronClearCache")) {
            logger.warn('[fishHunter][handleCronClearCache] return by CRON_DOING_EVENT["handleCronClearCache"] = ', getCRON_DOING_EVENT("handleCronClearCache"));
            return;
        }
        setCRON_DOING_EVENT("timerLoop", true);

        // 驗證耗時用
        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, 'handleCronClearCache', 1);

        // 找所有 fishHunter server 快取的線上玩家
        let onlinePlayers = await self.getAllFishHuntersFromFishHunterServer(false);

        // 驗證耗時用
        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, 'handleCronClearCache', 2);

        let currentNow = Date.now();
        let now = new Date(currentNow);

        // 依序檢查玩家
        if (onlinePlayers.length > 0) {
            let playerDao = self.app.controllers.daoMgr.getPlayerDao();
            count = onlinePlayers.length;
            for (let i = 0; i < count; i++) {
                let onlinePlayer = onlinePlayers[i];
                playerId = onlinePlayer.playerId;
                gameId = onlinePlayer.gameId;
                connectorId = onlinePlayer.connectorId;
                let player = await playerDao.findByIdAsync(playerId, true, connectorId);
                if (!player) throw ('playerId: ' + playerId + ', gameId: ' + gameId + ' 快取找到但memdb找不到!!');

                // 檢查玩家 session
                let sessionId = await self.app.controllers.fishHunterPlayer.getPlayerSessionId({
                    _id: playerId,
                    connectorId: connectorId
                }, 'handleCronClearCache');

                // // 檢查玩家 player.updateTime(在切換狀態時會更新)
                // switch (onlinePlayer.gameState) { //
                //   case consts.GameState.FREE:     // 在選桌畫面閒置中，變更時機：進入大廳、遊戲中離桌、入桌中離桌
                //     break;
                //   case consts.GameState.READY:    // 正在進入遊戲桌的途中，變更時機：執行坐下
                //     break;
                //   case consts.GameState.PLAYING:  // 正在遊戲桌內遊玩，變更時機：開始遊戲
                //     break;
                //   case consts.GameState.LEAVING:  // 正在離開遊戲桌的途中，變更時機：執行離桌
                //     break;
                // }
                // 檢查玩家 updateTime
                let checkTime = onlinePlayer.updateTime - (currentNow - self.app.controllers.fishHunterConfig.getParamDefinConfig().cronClearCacheTime * 60 * 1000);

                if (sessionId == null && checkTime < 0) {// 玩家不在線上且超過十分鐘就要開始清資料
                    logger.info('[fishHunterBackend][scheduleTask][handleCronClearCache] 開始釋放殘留快取 playerId: %s, gameId: ', playerId, gameId);

                    // 驗證耗時用
                    if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, 'handleCronClearCache', 2 + '-' + connectorId);

                    // 清遠端cache
                    let fishHunterBackends = self.app.getServersByType('fishHunterBackend');
                    if (!!fishHunterBackends) {
                        let fishHunterBackendCount = fishHunterBackends.length;
                        for (let j = 0; j < fishHunterBackendCount; j++) {
                            await P.promisify(self.app.rpc.fishHunterBackend.areaRemote.clearCacheWhenPlayerOffLine.toServer, self.app.rpc.fishHunterBackend.areaRemote)(fishHunterBackends[j].id, playerId, gameId);

                            // 驗證耗時用
                            if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, 'handleCronClearCache', 2 + '-' + connectorId + '-' + fishHunterBackends[j].id);
                        }
                    }

                    // 清線上玩家cache
                    self.app.controllers.fishHunterCache.delOnlinePlayer(playerId);

                    // 驗證耗時用
                    if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, 'handleCronClearCache', 2 + '-' + connectorId + '-' + playerId + '-done');
                } else {
                    notClearList.push({
                        playerId, gameId, connectorId, season: `sessionId: ${sessionId}, checkTime: ${checkTime}`
                    });
                }
            }
        }

        // 驗證耗時用
        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, 'handleCronClearCache', 3);

        // 整點印一下數量
        if (now.getMinutes() == 0 && now.getSeconds() == 0)
            if (!!notClearList && notClearList.length > 0)
                logger.info('[fishHunterBackend][scheduleTask][handleCronClearCache] notClearList = ', notClearList);

        setCRON_DOING_EVENT("handleCronClearCache", false);
    } catch (err) {
        logger.error('[fishHunterBackend][scheduleTask][handleCronClearCache] err: ', err);
        setCRON_DOING_EVENT("handleCronClearCache", false);
    }
}

proto.getAllFishHuntersFromFishHunterServer = async function (getAll) {
    let self = this;
    let count;
    try {
        // 找所有 fishHunter server 快取的線上玩家
        let onlinePlayers = [];

        let fishHunters = self.app.getServersByType('fishHunter');
        if (!!fishHunters) {
            count = fishHunters.length;
            for (let i = 0; i < count; i++) {
                let players;
                // 過濾本身所在的 fishHunter server
                if (fishHunters[i].id == self.app.getServerId())
                    players = self.app.controllers.fishHunterCache.getOnlinePlayers();
                else if (getAll)
                    players = await P.promisify(self.app.rpc.fishHunter.areaRemote.getOnlinePlayers.toServer, self.app.rpc.fishHunter.areaRemote)(fishHunters[i].id);

                if (!!players) {
                    for (let id in players) {
                        const player = players[id];
                        if (!player) {
                            continue;
                        }
                        onlinePlayers.push({
                            playerId: id,
                            connectorId: player.connectorId,
                            gameId: player.gameId,
                            dc: player.dc,
                            gameState: player.gameState,
                            updateTime: player.updateTime
                        });
                    }
                }
            }
        }

        return onlinePlayers;
    } catch (err) {
        logger.error('[fishHunterBackend][scheduleTask][getAllFishHuntersFromFishHunterServer] err: ', err);
    }
}

// 處理 API失敗的帳單確認
proto.handleAPIfailBillChecked = async function () {
    try {
        // 取得該台 server 的 API失敗 redis 暫存資料
        let checkedList = await this.app.controllers.redisCache.getWidsFromAPIfail(this.app.getServerId());
        if (!checkedList) return;
        // checkedWidList['kxQzjoxKjXEz6YE8EAdcUL100010717144802860'] = ['subId1', 'subId2', 'subId3'];
        let wIds = Object.keys(checkedList);
        if (wIds.length <= 0) return;
        //等待API Server回傳結果驗證
        let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.GSBridgeMethod.checkWidExist,
            platform: consts.APIServerPlatform.gsBridge,
            data: {wIds},
        };
        logger.info(`[scheduleTask][handleAPIfailBillChecked][CallAPI] ${this.app.getServerId()} checkWidExist ：`, opts);
        let apiData = await utils.httpPost(url, opts);
        if (!!apiData && apiData.status == apiCode.SUCCESS) {
            if (apiData.data.status == apiCode.SUCCESS) {
                logger.info(`[scheduleTask][handleAPIfailBillChecked][RES] ${this.app.getServerId()} checkWidExist ：`, JSON.stringify(apiData));
                let db_wIds = apiData.data.data;
                // 刪除 db 存在的 wId(代表扣款成功)
                for (let wagerId of wIds) {
                    if (db_wIds.indexOf(wagerId) > -1) {
                        delete checkedList[wagerId];
                        // 確認此單有在MySQL後，刪除 redis
                        this.app.controllers.redisCache.delWidFromAPIfail(this.app.getServerId(), wagerId);
                    }
                }
                if (Object.keys(checkedList).length <= 0) return;

                let delSubIds = []; // 刪除的子單列表
                let delMainIds = []; // 刪除的母單列表
                let delFailIds = []; // 未刪除成功的列表
                for (let wagerId in checkedList) {
                    const checkObj = checkedList[wagerId];
                    if (!checkObj) {
                        continue;
                    }
                    for (let subId of checkObj) {
                        if (subId.indexOf('main:') > -1) {
                            // 刪除扣款失敗的 mongo 母單
                            let main = await this.app.controllers.daoMgr.getAreaPlayerHistoryDao().removeByIdAsync(wagerId);
                            if (!!main) {
                                delMainIds.push(wagerId);
                            } else {
                                delFailIds.push(wagerId);
                            }
                        } else {
                            // 刪除扣款失敗的 mongo 子單
                            let sub = await this.app.controllers.daoMgr.getBulletHistoryDao().removeByIdAsync(subId);
                            if (!!sub) delSubIds.push(subId);
                            else delFailIds.push(wagerId);
                        }
                    }
                    // 刪除mongo子母單完畢後再刪除 redis
                    this.app.controllers.redisCache.delWidFromAPIfail(this.app.getServerId(), wagerId);
                }
                // 印出結束後刪除的子母單id
                if (delMainIds.length > 0) logger.info(`[scheduleTask][handleAPIfailBillChecked][END] ${this.app.getServerId()} 刪除母單數量: ${delMainIds.length} delMainIds:`, delMainIds);
                if (delSubIds.length > 0) logger.info(`[scheduleTask][handleAPIfailBillChecked][END] ${this.app.getServerId()} 刪除子單數量: ${delSubIds.length} delSubIds:`, delSubIds);
                if (delFailIds.length > 0) logger.info(`[scheduleTask][handleAPIfailBillChecked][END] ${this.app.getServerId()} 未刪除成功數量: ${delFailIds.length} delFailIds:`, delFailIds);
                return;
            } else {
                logger.warn(`[scheduleTask][handleAPIfailBillChecked][RES] ${this.app.getServerId()} checkWidExist API FAIL ：`, JSON.stringify(apiData));
                return;
            }
        } else {
            logger.warn(`[scheduleTask][handleAPIfailBillChecked][RES] ${this.app.getServerId()} checkWidExist webConnector FAIL ：`, JSON.stringify(apiData));
            return;
        }
    } catch (err) {
        logger.error(`[scheduleTask][handleAPIfailBillChecked] ${this.app.getServerId()} err: `, err);
        return;
    }
}