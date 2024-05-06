let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let utils = require('../../../utils/utils');
let m_md5 = require('md5');
const {Ret} = require("../../../utils/format-util");
const Mona = require("../../../dao/mona");

let Handler = function (app) {
    this.app = app;
    this.updateCannonTime = 0; // 砲台更新時間
    this.upgradeTimes = 0;     // 砲台更新次數
    this.stopUpdateCannon = false; // 暫停更新砲台
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new Handler(app);
};

const proto = Handler.prototype;
const cort = P.coroutine


proto.sitDown = async function (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        const playerId = session.uid;
        if (!playerId) {
            throw new Error("session not found");
        }


        const player = await this.mona.get({
            schema: this.app.models['FishHunterPlayer'],
            id: playerId
        });
        if (!player) {
            throw new Error("PLAYER_NOT_FOUND");
        }

        // 檢查玩家 session
        const sessionId = await this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'sitDown');
        if (!sessionId) {
            throw new Error("SessionId Not Found");
        }

        // 檢查非法狀態操作

        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.sitDown)) {
            throw new Error("Player Game State Check Failure");
        }

        if (!player.tableId) {
            throw new Error("TABLE_NOT_FOUND");
        }

        // const ret = yield this.app.controllers.sitDown.sitDownAsync(player, session.get('betSetting'));
        const betSetting = session.get('betSetting');
        const ret = await this.app.controllers.sitDown.sitDown(player, betSetting);
        if (ret.error) {
            throw new Error(ret.error);
        }
        Ret.data(next, ret.data);
    } catch (err) {
        logger.error('[areaHandler][sitDown] playerId: %s, err: ', session.uid, err);
        Ret.error(next, "", err);
    }
}


proto.standUp = cort(function* (msg, session, next) {
    this.app.controllers.debug.client(msg, session);
    if (!session.uid) return next(null, {code: C.ILLEGAL});

    try {
        let playerControl = this.app.controllers.fishHunterPlayer;
        let playerId = session.uid;
        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});
        if (!player.tableId) return next(null, {code: C.TABLE_NOT_FOUND});

        let ret = yield this.app.controllers.standUp.standUpAsync(player);
        if (!ret.error) {
            next(null, {code: C.OK, data: ret.data});
        } else {
            next(null, {code: ret.error});
        }
    } catch (err) {
        this.app.controllers.debug.info('err', 'standUp', {playerId: session.uid, catchError: err});
        next(null, {code: C.ERROR});
    }
});

proto.quitGame = cort(function* (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerControl = this.app.controllers.fishHunterPlayer;
        let playerId = session.uid;

        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'quitGame');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.quitGame))
            return next(null, {code: C.ERROR});
        if (!player.tableId) return next(null, {code: C.TABLE_NOT_FOUND});

        if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) {
            let rpc = this.app.rpc.fishHunterBackend.areaRemote.checkGameSettlementDone;
            // 檢查該場是否已經結帳完成 // 使用上一場登入的 gameId(未來多開，再改成現在登入的gameId)
            let gameSettlementDone = yield P.promisify(rpc.toServer, rpc)(session.get('fireServer'), player._id, session.get('gameId'), consts.route.client.clientAction.quitGame);
            if (!gameSettlementDone) {
                logger.info(`[areaHandler][quitGame] playerId: ${player._id}, gameSettlementDone: ${gameSettlementDone}, gameId: ${session.get('gameId')}, backendServerId: ${session.get('fireServer')}`);
                return next(null, {code: C.SETTLEMENT_STILL_ON_GOING}); // 後扣型該場未結帳完成，不給離桌
            }
        }

        // 場次編號
        player['roundID'] = session.get('roundID');
        // 域名設定使用的dc
        player['dsUseDc'] = session.get('domainSetting') ? session.get('domainSetting').useDc : session.get('dc');
        let ret = yield this.app.controllers.standUp.quitGameAsync(player, session.get('accessToken'), session.get('fireServer'), session.get('betSetting'));
        if (!ret.error) {
            next(null, {code: C.OK});
        } else {
            next(null, {code: ret.error});
        }
    } catch (err) {
        logger.error('[areaHandler][quitGame] playerId: %s, err: ', session.uid, err);
        next(null, {code: C.ERROR});
    }
});

proto.onUpdateCannon = cort(function* (msg, session, next) {
    this.app.controllers.debug.client(msg, session);
    if (!session.uid) return next(null, {code: C.ILLEGAL});

    try {
        let playerControl = this.app.controllers.fishHunterPlayer;
        let params = msg.query || msg.body;
        let playerId = session.uid;



        if (!params.hasOwnProperty('upgrade')) return next(null, {code: C.ILLEGAL});

        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onUpdateCannon');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onUpdateCannon))
            return next(null, {code: C.ERROR});
        if (!player.tableId) {
            return next(null, {code: C.TABLE_NOT_FOUND});
        }

        // const updateCannonTime = Date.now() - this.updateCannonTime;
        // const config = this.app.controllers.fishHunterConfig.getParamDefinConfig(); // 取得參數設定檔
        // // 5秒內按超過25次 => 鎖30秒
        // if (updateCannonTime < config.stopUpdateCannon_time && this.stopUpdateCannon) {
        //   return next(null, {code: C.PLAYER_OUT_UPDATECANNON});
        // }

        // 檢查執行幾次的砲台+-
        if (params.hasOwnProperty('upgrade')) {
            this.upgradeTimes++;
        }

        // this.app.controllers.fishHunterCache.addUpdateCannonTimes(playerId, this.upgradeTimes);
        // let totalTimes = this.app.controllers.fishHunterCache.getUpdateCannonTimes(playerId);

        // // 5秒只能執行25次
        // if (updateCannonTime < config.execution_time) {
        //   if (totalTimes >= config.maxTimes) {
        //     this.stopUpdateCannon = true; // 開啟 30秒內停止更新砲台機制
        //     return next(null, {code: C.PLAYER_OUT_UPDATECANNON});
        //   }
        // }
        // else {
        //   this.app.controllers.fishHunterCache.clearUpdateCannonTimes(playerId);
        //   this.upgradeTimes = 0;
        // }
        // this.stopUpdateCannon = false; // 關閉 30秒內停止更新砲台機制
        // this.updateCannonTime = Date.now();

        let ret = yield this.app.controllers.fishHunterGame.onUpdateCannonAsync(player, params.upgrade, session.get('betSetting'));

        if (!ret.error) {
            next(null, {code: C.OK, data: ret.data});
        } else {
            next(null, {code: ret.error});
        }

    } catch (err) {
        logger.error('fishHunter onUpdateCannon error ', err);
        next(null, {code: C.ERROR});
    }
});

proto.onLockTarget = cort(function* (msg, session, next) {
    this.app.controllers.debug.client(msg, session);
    if (!session.uid) {
        return next(null, {code: C.ILLEGAL});
    }

    try {
        let playerControl = this.app.controllers.fishHunterPlayer;
        let params = msg.query || msg.body;
        let playerId = session.uid;

        if (!params.hasOwnProperty('lock')) {
            return next(null, {code: C.ILLEGAL});
        }

        logger.info('onLockTarget player ', playerId);
        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) {
            return next(null, {code: C.PLAYER_NOT_FOUND});
        }

        if (!player.tableId) {
            return next(null, {code: C.TABLE_NOT_FOUND});
        }

        let ret = yield this.app.controllers.fishHunterGame.onLockTargetAsync(player, params.lock, session.get('betSetting'));

        if (!ret.error) {
            next(null, {code: C.OK, data: ret.data});
        } else {
            next(null, {code: ret.error});
        }

    } catch (err) {
        logger.error('fishHunter onLockTarget error ', err);
        next(null, {code: C.ERROR});
    }
});


proto.onPushChatMsg = cort(function* (msg, session, next) {
    this.app.controllers.debug.client(msg, session);
    if (!session.uid) {
        return next(null, {code: C.ILLEGAL});
    }

    try {
        let playerControl = this.app.controllers.fishHunterPlayer;
        let params = msg.query || msg.body;
        let playerId = session.uid;



        logger.info('onPushChatMsg player ', playerId);
        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onPushChatMsg');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onPushChatMsg))
            return next(null, {code: C.ERROR});
        if (!player.tableId) {
            return next(null, {code: C.TABLE_NOT_FOUND});
        }

        this.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.CHAT_MESSAGE, {msg: params.content}, false);

        next(null, {code: C.OK, data: {}});

    } catch (err) {
        logger.error('fishHunter onPushChatMsg error ', err);
        next(null, {code: C.ERROR});
    }
});

//Client開啟兌換介面
proto.onWalletAndAccountInfo = async function (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);

        const playerId = session.uid;
        if (!playerId) {
            throw new Error("session not found: " + playerId)
        }

        const params = msg.query || msg.body || {};

        const player = await this.mona.get({
            schema: this.app.models['FishHunterPlayer'],
            id: playerId,
        });

        if (!player) {
            return Ret.error(next, "Player Not Found: " + playerId, null, C.PLAYER_NOT_FOUND);
        }

        player['dsUseDc'] = session.get('domainSetting')
            ? session.get('domainSetting').useDc
            : session.get('dc');

        const gameId = params.gameId || session.get("gameId");
        const token = await this.mona.findOne({
            schema: this.app.models['GameTokens'],
            query: {
                gameId: gameId,
                playerId: playerId,
            }
        });

        if (!token) {
            throw new Error("game token not found");
        }


        const quota = token['quota'] * 1;
        const tokenAmount = token['tokenAmount'] * 1;

        const ret = {
            credit: quota,
            tokens: tokenAmount || 0,
            info: token,
        };

        Ret.data(next, ret);

    } catch (err) {
        logger.error('[areaHandler][onWalletAndAccountInfo] playerId: %s, err: ', session.uid, err);
        Ret.error(next, 'onWalletAndAccountInfo', err);
    }
};


//Client兌換
proto.onCurrencyExchange = async function (msg, session, next) {
    try {
        let self = this;
        self.app.controllers.debug.client(msg, session);

        const params = msg.query || msg.body || {};

        const ret = {
            creditAmount: 120000,
            amount: 130000,
            ratio: 1,
        };

        /*
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerControl = self.app.controllers.fishHunterPlayer;

        // 檢查前端送的amount是否溢位
        let point = _.toString(params.amount).split('.')[1];
        if (!!point && point.length > 2) return next(null, { code: C.ERROR, msg: 'Amount is wrong.'});
         */

        let playerId = session.uid;
        let gameId = session.get("gameId");

        //防止惡意連續事件請求


        /*
        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});
         */

        // 檢查前端送來的 gameId 是否與 memdb player 不同
        /*
        if (params.gameId !== player.gameId || gameId !== player.gameId) return next(null, {code: C.ERROR});
         */

        params.ratio = 1;
        /*
        if (!_.isNumber(params.ratio) || params.ratio !== 1) {
          logger.error(`[areaHandler][onCurrencyExchange] ratio is not number or not 1. ratio: ${params.ratio}, playerId: ${player._id}, gameId: ${gameId}`);
          params.ratio = 1;
        }
         */

        // 檢查玩家 session
        /*
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onCurrencyExchange');
        if (!sessionId) return next(null, {code: C.ERROR});
         */

        // 檢查非法狀態操作
        /*
        if (!self.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onCurrencyExchange))
          return next(null, {code: C.ERROR});
        switch (player.isSingleWallet) {
          case consts.walletType.multipleWallet:
            break;
          default:
            return next(null, {code: C.PLAYER_IS_SINGLE_WALLET});
            break;
        }
         */

        /*
        switch (player.accountState) {
          case consts.AccountState.SUSPEND:
            self.app.controllers.debug.info('warn', 'onCurrencyExchange', {
              playerId: playerId,
              userName: player.nickName,
              reason: '拒絕轉帳: 玩家帳號被停用, AccountState: ' + player.accountState,
            });
            return next(null, {code: C.PLAYER_STATE_FREEZE});
          case consts.AccountState.FREEZE:
            self.app.controllers.debug.info('warn','onCurrencyExchange',{
              playerId: playerId,
              userName: player.nickName,
              reason: '拒絕轉帳: 玩家帳號被凍結, AccountState: ' + player.accountState,
            });
            return next(null, {code: C.PLAYER_STATE_FREEZE});
        }
         */

        // 場次編號
        // player['roundID'] = session.get('roundID');
        // 域名設定使用的dc
        // player['dsUseDc'] = session.get('domainSetting') ? session.get('domainSetting').useDc : session.get('dc');

        /*
        let data = yield self.app.controllers.fishHunterPlayer.accountToWalletAsync(player, params.amount, params.ratio, 'onCurrencyExchange', false, session.get('fireServer'));
        self.app.controllers.debug.info('info','onCurrencyExchange',{ playerId, params, ExchangeResult:data, loginIP:player.loginIP } );

        if (!data.code) { // null: 成功
          let reData = {
            creditAmount: data.data.creditAmount,
            playerId: player._id,
            amount: data.data.amount,
          };
          let rpc = self.app.rpc.fishHunterBackend.areaRemote;
          let fireServer = session.get("fireServer");
          if(!!fireServer) {
            rpc.onExchange.toServer(fireServer,playerId, gameId, session.get('betSetting'), (err, rsp) => {
              logger.info(`onCurrencyExchange.rpc.onExchange playerId: ${player._id} rsp:`, rsp);
              // if (!rsp) // rsp 回傳 undefined // 發生原因: 該台 backendServer 掛掉重啟 & rpc time out
              if (!!rsp && !rsp.error) reData.amount = rsp.balance;
            });
          }
          if (!!player.tableId) self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_WALLET, reData, false);

          let modelAreaPlayers = self.app.models.FishHunterAreaPlayers;
          let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: player.areaId, playerId: player._id});
          if (!!areaPlayer) {
            areaPlayer.denom = data.data.ratio;
            yield  areaPlayer.saveAsync();
          }

          next(null, {code: C.OK, data: data.data});
        } else {
          if (player.demo !== consts.demoType.demo && data.return_mysql) {
            logger.info(`[areaHandler][onCurrencyExchange] amount return mysql. playerId: ${player._id}, amount: ${params.amount}, dc: ${player.dc}`);
            // 正式or測試帳號 // 轉帳失敗把錢轉回 MySQL
            let account = yield self.app.controllers.account.modifyCreditByPlayerIdAsync(player, Math.abs(params.amount), player.currency, 'onCurrencyExchange', false, false, data.logQuotaId);
            if (!account || account.error) logger.error('[areaHandler][onCurrencyExchange] 轉帳失敗: 要把錢轉回 MySQL 時還是失敗, playerId: %s, amount: %s, logQuotaId: %s, errorcode: %s, player: %s', player._id, params.amount, data.logQuotaId, account.error, JSON.stringify(player));
          }
          next(null, {code: data.code, reason: data.reason});
        }
         */
        Ret.data(next, ret);

    } catch (err) {
        logger.error('[areaHandler][onCurrencyExchange] playerId: %s, err: ', session.uid, err);
        // next(null, {code: C.ERROR});
        Ret.error(next, 'onCurrencyExchange', err);
    }
};


// proto.onLobbyCurrencyExchange = cort(function*(msg, session, next) {
//   this.app.controllers.debug.client( msg, session );
//   if (!session.uid) return next(null, {code: C.ILLEGAL});
//
//   try {
//     let playerControl = this.app.controllers.fishHunterPlayer;
//     let params = msg.query || msg.body;
//     let playerId = session.uid;
//     //logger.info('onCurrencyExchange player ', playerId);
//     let player = yield playerControl.findReadOnlyAsync(playerId);
//     if (!player) {
//       return next(null, {code: C.PLAYER_NOT_FOUND});
//     }
//
//     let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
//     let accessToken = session.get('accessToken');
//     let url = config.webConnectorUrl;
//     let opts = {
//       platform: 'bbin',
//       method: 'creditExchange',
//       productId: player.gameId,
//       token: accessToken,
//       amount: params.amount,
//       status: 0
//     };
//
//     let cash = yield utils.httpPost(url, opts);
//
//     if (!cash || cash.status != '0000') {
//       //logger.warn('bbinCreditExchange fail ', cash);
//       return next(null, {code: C.ERROR});
//     }
//     //logger.warn('bbinCreditExchange result ',cash);
//     let cashAfter = cash.data.after;
//
//     //logger.warn('exchange ', params);
//     //let data = yield this.app.controllers.fishHunterPlayer.accountToWalletAsync(playerId, params.gameId, params.amount, params.ratio, 'exchange', false);
//
//     //logger.warn('exchange result ', cash);
//     if (!!cash) {
//       //let modelAreaPlayers = this.app.models.FishHunterAreaPlayers;
//       //let areaPlayer = yield modelAreaPlayers.findOneAsync({areaId: player.areaId, playerId: player._id});
//       //areaPlayer.denom = data.ratio;
//       //yield  areaPlayer.saveAsync();
//
//       //if (!!player.tableId) {
//       //  this.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_WALLET, data, false);
//       //}
//       let data = {
//         amount:cash.data.balance,
//         cashBalance:cash.data.after,
//         creditAmount:0,
//         creditCode:cash.data.creditCode,
//         delta:utils.number.sub(cash.data.before, cash.data.after),
//         gameId:cash.data.productId,
//         playerId:player.id,
//         ratio:cash.data.exchangeRates,
//         total:cash.data.amount,
//         _id:cash.data._id
//       };
//       //data.cashBalance = cashAfter;
//       next(null, {code: C.OK, data: data});
//     }
//     else {
//       next(null, {code: C.ERROR});
//     }
//
//   }
//   catch (err) {
//     //logger.error('fishHunter onLobbyCurrencyExchange error ', err);
//     next(null, {code: C.ERROR});
//   }
// });

proto.onBornFish = cort(function* (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerControl = this.app.controllers.fishHunterPlayer;
        let playerId = session.uid;


        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onBornFish');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onWalletAndAccountInfo))
            return next(null, {code: C.ERROR});
        if (!player.tableId) return next(null, {code: C.TABLE_NOT_FOUND});
        if (!player.areaId) return next(null, {code: C.PLAYER_AREA_NOT_EXIST, reason: 'Player areaId not exist !!'});
        if (player.gameState !== consts.GameState.PLAYING) return next(null, {code: C.PLAYER_NOT_PLAYING});

        let area = this.app.controllers.fishHunterCache.findFishArea(player.areaId);
        if (!area) next(null, {code: C.PLAYER_AREA_NOT_EXIST, reason: 'Area not exist !!'});
        if (area.state !== consts.AreaState.START) return next(null, {code: C.ERROR, reason: 'Area not start !!'});

        let config = this.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
        // 冰凍暫停時間
        if (Date.now() - area.pauseTime < config.scene.PAUSE_SCREEN_TIME_DELAY) return next(null, {
            code: C.ERROR,
            reason: 'Pause screen !!'
        });
        // 換場
        if (area.stage == consts.AreaStage.WAIT) return next(null, {code: C.ERROR, reason: 'Change scene !!'});

        let params = msg.query || msg.body;
        let fishes = params.fishes;
        let sceneData = {
            type: 'onBornFish',
            fishIds: [],
            paths: [],
            fishType: ''
        };


        if (fishes.length > 0) {
            // 初始化
            if (!area.debugBornFish) area.debugBornFish = 0;
        }

        for (let i = 0; i < fishes.length; i++) {
            area.debugBornFish++; // 遞增debug生魚隻數 // 預防同一個時間魚id重複
            sceneData.fishType = fishes[i].fishType;
            this.app.controllers.fishHunterArea._spawnFish(area, 40, sceneData, fishes[i].state, Date.now() + area.debugBornFish);
        }

        next(null, {code: C.OK, data: {}});
    } catch (err) {
        logger.error('[areaHandler][onBornFish] playerId: %s, err: ', session.uid, err);
        next(null, {code: C.ERROR});
    }
});

proto.onKillFirst = async function (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) {
            throw new Error("empty session id");
        }
        const playerControl = this.app.controllers.fishHunterPlayer;
        const playerId = session.uid;

        //防止惡意連續事件請求
        const gameId = session.get("gameId");

        //擋測試模式才可使用
        if (this.app.get('env') !== 'development') {
            throw new Error("only valid in development environment");
        }

        // let player = yield playerControl.findReadOnlyAsync(playerId);
        const player = await this.mona.getReadOnly({
            schema: this.app.models['FishHunterPlayer'],
            id: playerId,
        });
        if (!player) {
            throw new Error("PLAYER_NOT_FOUND");
        }

        // 檢查玩家 session
        const sessionId = await this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onKillFirst');
        if (!sessionId) {
            throw new Error("sessionId not found");
        }

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onWalletAndAccountInfo)) {
            throw new Error("illegal game state");
        }
        if (!player.tableId) {
            throw new Error("TABLE_NOT_FOUND");
        }
        if (player.gameState !== consts.GameState.PLAYING) {
            throw new Error("PLAYER_NOT_PLAYING");
        }

        let area = this.app.controllers.fishHunterCache.findFishArea(player.areaId);
        if (!area) {
            throw new Error("Area not exist");
        }

        if (area.state !== consts.AreaState.START) {
            throw new Error("Area not start");
        }

        // let config = this.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
        // 冰凍暫停時間
        // if (Date.now() - area.pauseTime < config.scene.PAUSE_SCREEN_TIME_DELAY) return next(null, {code: C.ERROR, reason: 'Pause screen !!'});
        // 換場
        // if (area.stage == consts.AreaStage.WAIT) return next(null, {code: C.ERROR, reason: 'Change scene !!'});

        session.set('onKillFirst', true);
        session.pushAll();

        Ret.data(next, {});
    } catch (err) {
        logger.error('[areaHandler][onKillFirst] playerId: %s, err: ', session.uid, err);
        Ret.error(next, "", err);
    }
};

proto.onNoDiefirst = cort(function* (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerControl = this.app.controllers.fishHunterPlayer;
        let playerId = session.uid;



        //擋測試模式才可使用
        if (this.app.get('env') != 'development')
            return next(null, {code: C.ERROR});

        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onNoDiefirst');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onWalletAndAccountInfo))
            return next(null, {code: C.ERROR});
        if (!player.tableId) return next(null, {code: C.TABLE_NOT_FOUND});
        if (player.gameState !== consts.GameState.PLAYING) return next(null, {code: C.PLAYER_NOT_PLAYING});

        let area = this.app.controllers.fishHunterCache.findFishArea(player.areaId);
        if (!area) return next(null, {code: C.ERROR, reason: 'Area not exist !!'});
        if (area.state !== consts.AreaState.START) return next(null, {code: C.ERROR, reason: 'Area not start !!'});

        let config = this.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
        // 冰凍暫停時間
        if (Date.now() - area.pauseTime < config.scene.PAUSE_SCREEN_TIME_DELAY) return next(null, {
            code: C.ERROR,
            reason: 'Pause screen !!'
        });
        // 換場
        if (area.stage == consts.AreaStage.WAIT) return next(null, {code: C.ERROR, reason: 'Change scene !!'});

        session.set('onNoDiefirst', true);
        session.pushAll();

        next(null, {code: C.OK, data: {}});
    } catch (err) {
        logger.error('[areaHandler][onNoDiefirst] playerId: %s, err: ', session.uid, err);
        next(null, {code: C.ERROR});
    }
});

proto.onUpdatePosition = cort(function* (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerControl = this.app.controllers.fishHunterPlayer;
        let playerId = session.uid;


        let player = yield playerControl.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'onUpdatePosition');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.onUpdatePosition))
            return next(null, {code: C.ERROR});
        if (!player.tableId) return next(null, {code: C.TABLE_NOT_FOUND});
        if (player.gameState !== consts.GameState.PLAYING) return next(null, {code: C.PLAYER_NOT_PLAYING});

        this.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_POSITION, msg, false);

        next(null, {code: C.OK, data: {}});
    } catch (err) {
        logger.error('[areaHandler][onUpdatePosition] playerId: %s, err: ', session.uid, err);
        next(null, {code: C.ERROR});
    }
});

proto.transition = cort(function* (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        if (!session.uid) return next(null, {code: C.ILLEGAL});
        let playerId = session.uid;


        let player = yield this.app.controllers.fishHunterPlayer.findReadOnlyAsync(playerId);
        if (!player) return next(null, {code: C.PLAYER_NOT_FOUND});

        // 檢查玩家 session
        let sessionId = yield this.app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'transition');
        if (!sessionId) return next(null, {code: C.ERROR});

        // 檢查非法狀態操作
        if (!this.app.controllers.playerGameStateDef.check(player, consts.route.client.clientAction.transition))
            return next(null, {code: C.ERROR});
        if (!player.tableId) return next(null, {code: C.TABLE_NOT_FOUND});
        if (!player.areaId) return next(null, {code: C.PLAYER_AREA_NOT_EXIST});
        if (player.gameState !== consts.GameState.PLAYING) return next(null, {code: C.PLAYER_NOT_PLAYING});
        let area = this.app.controllers.fishHunterCache.findFishArea(player.areaId);
        if (!area) {
            logger.warn('[areaHandler][transition] playerId: %s, areaId: %s, cache area is not find: ', playerId, player.areaId, area);
            return next(null, {code: C.ERROR, msg: '場景不存在'});
        }

        area.stage = consts.AreaStage.WAIT;
        //切换场景并发送消息
        yield this.app.controllers.fishHunterArea.onChangeSceneAsync(area);

        next(null, {code: C.OK, data: {}});
    } catch (err) {
        logger.error('[areaHandler][transition] playerId: %s, err: ', session.uid, err);
        next(null, {code: C.ERROR});
    }
});
