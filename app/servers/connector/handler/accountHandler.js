let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let versionConfig = require('../../../../config/version');
let utils = require('../../../utils/utils');
let jwt_decode = require('jwt-decode');
const apiCode = require('../../../expressRouter/apiServerStatus');
// let m_md5 = require('md5');
// let redisCache = require('../../../controllers/redisCache');
// let publicIp = require('public-ip');

const Mona = require('../../../dao/mona')
const {Ret} = require("../../../utils/format-util");

/*
let mockData = { code: C.OK,
    "data": {
      "playerId": name,
      "nickName": name,
      "creditAmount": 1000000,
      "isSingleWallet": 0,
      "lobbyBalance": true,
      "showClock": true,
      "showHelp": true,
      "oneClickHelp": true,
      "isDemo": 2,
      "player": {
        "nickName": name,
        "gameServerId": "fishHunter-server-0",
        "connectorId": "connector-server-0",
        "hallId": "131",
        "gameId": "10001",
        "tableId": "",
        "gameState": "free",
        "id": name,
        "areaId": "",
        "gold": 0,
        "currency": "CNY"
      },
      "score": {"Fish_000":[2],"Fish_001":[2],"Fish_002":[3],"Fish_003":[4],"Fish_004":[5],"Fish_005":[6],"Fish_006":[7],"Fish_007":[8],"Fish_008":[9],"Fish_009":[10],"Fish_010":[12],"Fish_011":[15],"Fish_012":[18],"Fish_013":[20],"Fish_014":[25],"Fish_015":[30],"Fish_016":[40],"Fish_017":[50],"Fish_018":[80],"Fish_019":[100],"Fish_100":[50,75,100,125,150],"Fish_101":[100,150,200,250,300,350,400,450,500],"Fish_200":[40,80,120,160,200],"Fish_201":[50,100,150,200,250,300,1000],"Fish_300":[10],"Fish_301":[10],"Fish_302":[10],"Fish_303":[5]},
      "cannonCost": [[0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1,2,3,4,5,6,7,8,9,10],[1,2,3,4,5,6,7,8,9,10,20,30,40,50,60,70,80,90,100],[10,20,30,40,50,60,70,80,90,100,150,200,250,300,350,400,450,500]],
      "maxBullets": [20,20,20],
      "autoplayList": ["Fish_000","Fish_001","Fish_002","Fish_003","Fish_004","Fish_005","Fish_006","Fish_007","Fish_008","Fish_009","Fish_010","Fish_011","Fish_012","Fish_013","Fish_014","Fish_015","Fish_016","Fish_017","Fish_018","Fish_019","Fish_100","Fish_101","Fish_200","Fish_201","Fish_300","Fish_301","Fish_302","Fish_303"],
      "cannonLevel": [[0.1,1,5],[1,10,50],[10,100,400]],
      "speed": {
        "bulletFlySpeed": {
          "normalBulletSpeed": 1500,
          "bazookaBulletSpeed": 1800,
          "drillBulletSpeed": 3000
        },
        "bulletFireSpeed": {
          "normalFireSpeed": 150,
          "autoFireSpeed": 150,
          "bazookaFireSpeed": 150
        }
      },
      "version": "2.3.7.23.20 p",
      "idleTime": 600000 //没用到
    }
  };
 */


let Handler = function (app) {
    this.app = app;
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new Handler(app);
};

const proto = Handler.prototype;
const cort = P.coroutine;

proto.twLoginParse = function (msg, session) {
    const self = this;
    const opts = {};
    // key 轉成小寫
    Object.keys(msg).map(function (key) {
        opts[key.toLowerCase()] = msg[key];
    });


    /***** 取 IP 順序 ****
     * 1. socket -> headers -> x-original-forwarded-for   正常 CDN 有幫忙轉送的情況下能取到發送端ip，準確度較高但可能取不到
     * 2. client -> msg.ip                                從手機前端以第三方套件取到塞在封包中的ip，但因有可能遭串改未必為真
     * 3. sessionService -> (socket -> remoteAddress)     死馬當活馬醫，基本上錯誤率高
     ********************/
    let socketHeaders = session.__session__.__socket__.socket.upgradeReq.headers;
    logger.info('[accountHandler][twLogin] socketIP: %s, clientIP: %s, sessionIP: %s', socketHeaders['x-original-forwarded-for'], msg['ip'], JSON.stringify(session.__session__.__socket__.remoteAddress));

    if (socketHeaders.hasOwnProperty("x-original-forwarded-for")) {
        if (utils.isIPv6(socketHeaders['x-original-forwarded-for'].split(',')[0])) {
            opts.ip = socketHeaders['x-original-forwarded-for'].split(',')[0];
        } else {
            opts.ip = '::ffff:' + socketHeaders['x-original-forwarded-for'].split(',')[0];
        }
    } else if (msg.hasOwnProperty("ip") && msg['ip'] !== '') {
        if (utils.isIPv6(msg['ip'])) {
            opts.ip = msg['ip'];
        } else {
            opts.ip = '::ffff:' + msg['ip'];
        }
    } else {
        let sessionService = self.app.get('sessionService');
        // 前端未傳IP
        let remoteAddress = sessionService.getClientAddressBySessionId(session.id);
        if (!remoteAddress) {
            logger.debug('[accountHandler][twLogin] loginIp: %s, ip: %s', loginIp, JSON.stringify(session.__session__.__socket__.remoteAddress));
            // 登入到一半又重新整理遊戲頁面，session斷了，導致找不到session跳錯，故return
            throw new Error("remoteAddress not found");
            // return next(null, {code: C.ERROR});
        }
        opts.ip = remoteAddress.ip + ':' + remoteAddress.port;
    }

    return opts;
}

proto.onSessionClose = async function (session, reason) {

    const self = this;

    let closed = true;
    if (!session.uid) {
        return;
    }

    // if(reason == 'kickSync') {
    if (_.isString(reason)) {
        if (reason.indexOf('kickSync') > -1) {
            session.unbind(session.uid);
            return;
        }
    }

    if (!!reason) {
        closed = false; // unused...somehow
    }

    let sessionData = {
        accessToken: !session.get('accessToken') ? '' : session.get('accessToken'),
        fireServerId: session.get('fireServer'),
        roundID: session.get('roundID'),
        os: session.get('os'),
        osVersion: session.get('osVersion'),
        browser: session.get('browser'),
        browserVersion: session.get('browserVersion'),
        betSetting: session.get('betSetting'),
        domainSetting: session.get('domainSetting'),
    };

    this.app.controllers.debug.info('info', 'detected.sessionClose', {
        playerId: session.uid,
        reason: reason,
        roundID: sessionData.roundID,
        os: sessionData.os,
        browser: sessionData.browser,
        desc: '偵測到視窗關閉自動離場&登出',
    });

    const gameId = session.get("gameId");
    const accountController = this.app.controllers['account'];
    const rpc = accountController.getRemoteLoginSvr(gameId);


    // auto logout on disconnect
    P.promisify(rpc.logout, rpc)(session.uid, session.uid, sessionData, consts.PlayerStateDesc.LOG_OUT, rpc)
        .then(() => {
            session.unbind(session.uid);
            self.app.controllers.debug.info('info', 'detected.sessionClose.success', {
                playerId: session.uid,
                reason: reason,
                roundID: sessionData.roundID,
                // state:'success auto logout on disconnect',
                desc: '自動離場&登出-成功',
                fireServerId: session.get('fireServer'),
            });
        })
        .catch(async function (e) {
            await P.promisify(rpc.clearPlayer, rpc)(session.uid, session.uid);
            self.app.controllers.debug.info('error', 'detected.sessionClose.catchError', e, 1);
        });

}


proto.twLoginSession = async function (
    session,
    msg,
    ret,
    app,
) {

    session.on('closed', this.onSessionClose.bind(this));

    await P['promisify'](session.bind, session)(ret.playerId);

    session.set('bound', true);
    session.set('gameId', ret.gameId);
    session.set('playerId', ret.playerId);
    session.set('os', msg.os);
    session.set('osVersion', msg.osVersion);
    session.set('browser', msg['browserType']);
    session.set('browserVersion', msg.browserVersion);
    session.set('demoMode', ret.demoMode);
    session.set('dc', ret.dc);
    session.set('agentId', ret.UpId);
    session.set('accessToken', ret.token);
    session.set('roundID', ret.roundID); // 場次編號
    session.set('gameServerId', ret.gameServerId);
    session.set('betSetting', ret.betSetting);
    session.set('domainSetting', ret.domainSetting);

    session.set('appServerId', app.getServerId());

    session.pushAll();
}


proto.getCommonConfig = function (gameId, currency, dc, betSetting) {
    try {
        const commonConfig = this.app.controllers.fishHunterConfig.getCommonConfig(gameId); // 取得共同遊戲設定檔
        let cannonCost = [];    // table bet range
        let cannonLevel = [];
        let maxBulletsArr = []; // table maxBullets
        let autoplayList = [];
        let roomMinRequestAry = [];

        const roomConfig = this.app.controllers.fishHunterConfig.getRoomConfig(gameId);
        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
            logger.error(`[accountHandler][getCommonConfig] no betSetting`);
            return null;
        }
        // let currencyConfig = this.app.controllers.fishHunterConfig.getCurrencyConfigByDC(dc);
        // if (!currencyConfig) currencyConfig = this.app.controllers.fishHunterConfig.getCurrencyConfig();
        const roomConfigList = Object.keys(roomConfig.room);
        let gameConfig;
        for (let lvl of roomConfigList) {
            gameConfig = this.app.controllers.fishHunterConfig.getGameConfig(gameId, lvl);
            maxBulletsArr.push(gameConfig.cannon.maxBullets);
            // cannonCost.push(currencyConfig[(currency)].cannon.cost[lvl]);
            // cannonLevel.push(currencyConfig[(currency)].cannon.level[lvl]);
            // roomMinRequestAry.push(currencyConfig[(currency)].room.minRequest[lvl]);
            cannonCost.push(betSetting.info.levels[lvl].cannon.cost);
            cannonLevel.push(betSetting.info.levels[lvl].cannon.level);
            roomMinRequestAry.push(betSetting.info.levels[lvl].minRequest);
        }

        if (!!commonConfig) {
            autoplayList = commonConfig.autoplayList;
        }
        // === 分數設定檔 ========================================================
        const fishScore = this.app.controllers.fishHunterConfig.getFishScoreConfig(gameId);
        let score = {};         // 儲存各魚種的分數列表
        if (!!fishScore) {
            const fishTypeList = Object.keys(fishScore); // 將設定檔的魚種轉換為陣列
            for (let fishType of fishTypeList) {
                let bonusList = [];
                if (fishScore[fishType].avg > 0) {
                    fishScore[fishType].vals.map((item) => {
                        if (item.tabprob > 0) {
                            item.tabvals.map((value) => {
                                if (value.bonus > 0 && bonusList.indexOf(value.bonus) == -1)
                                    bonusList.push(value.bonus); // 個別取出每隻魚的bonus，並push到bonusList列表內
                            });
                        }
                    });
                }
                score[fishType] = bonusList; // 把bonus列表放到該魚種(fishType)內
            }
        }
        // ======================================================================

        // 取共同設定速度
        let speed = commonConfig.speed;
        if (!speed) {
            speed = this.app.controllers.fishHunterConfig.getParamDefinConfig().speed; // 取得共同遊戲設定檔 by all
        }

        speed = {
            bulletFlySpeed: speed['bulletFly'],  // 子彈飛行速度
            bulletFireSpeed: speed['fire'],      // 子彈發射速度
        };

        /* 取 extraBetBase
        * 假設 bet 1, rtp 96%, 欲直購20場
        * 20場後的平均倍數 =  20 * 0.96 = 19.2
        * 玩家平均 win 分 = 19.2 * 1 = 19.2
        * 要直購花的錢 = 19.2 / 0.96 = 20.0
        * 所以 extraBetBase = round * rtp * bet / rtp = round * bet
        * */
        let extraBetBase;
        const fishTypeConfig = this.app.controllers.fishHunterConfig.getFishTypeConfig(gameId);
        extraBetBase = fishTypeConfig['extraBetTime'] || 0;

        return {
            score,                    // 所有魚種分數列表
            cannonCost,               // 各廳 bet range
            maxBullets: maxBulletsArr,// 各廳最大子彈數
            autoplayList,             // 自動發射列表
            cannonLevel,
            speed,
            extraBetBase,             // extrabet 基準
            // roomMinRequestAry         // 最低入房限制
        };
    } catch (err) {
        logger.error('[accountHandler][getCommonConfig] gameId: %s, currency: %s, err: ', gameId, currency, err);
        throw err;
    }
}


proto.twLogin = async function (msg, session, next) {

    const self = this;
    const gameId = msg.gameId || "10001";
    const playerId = msg.uid || "test";

    const ret = {
        "gameId": gameId,
        "playerId": playerId,
        "nickName": playerId,
    };

    const cache = this.app.controllers.fishHunterCache;
    try {
        this.app.controllers.debug.client(msg, session);

        const opts = this.twLoginParse(msg, session);

        const demoMode = opts.demo;

        // 檢查玩家是否還在登入中
        /*
        let checkLogin = cache.getApiAuthInfo(playerId, '10000', consts.route.client.clientAction.twLogin);
        if (checkLogin) {
          logger.warn(`[accountHandler][twLogin][${checkLogin}] player is in login process. playerId: ${playerId}, token: ${opts.launchToken}`);
          return next(null, {code: C.API_AUTH_FAIL, msg: 'is login.'});
        }
        // 設定玩家登入中
        cache.setApiAuthInfo(playerId, '10000', consts.route.client.clientAction.twLogin);
         */

        // const accountController = this.app.controllers['account'];

        ret.gameId = gameId;
        ret.demoMode = demoMode;
        ret.playerId = playerId;

        const player = await this.mona.get({
            schema: this.app.models['FishHunterPlayer'],
            id: playerId,
        });

        // TODO non-demo account
        const demoController = self.app.controllers['accountDemo'];
        const accountRet =
            await demoController.getOneFreeDemoAccount(
                opts,
                player ? player.playerId : ""
            );

        const account = accountRet.data;
        for (let k in account) {
            ret[k] = account[k];
        }

        if (player) {
            ret.player = player;
            ret.playerId = player._id;
            ret.userName = player.userName || player._id;
            ret.nickName = player.nickName || player.userName || player._id;
        }

        // 不是多錢包，傳給前端的值要改成單錢包
        if (ret['isSingleWallet'] !== 0) {
            ret['isSingleWallet'] = 1;
        }

        // 取得遊戲共同設定檔
        const creditCode = ret.creditCode || "CNY";
        const commonConfig = this.getCommonConfig(
            gameId,
            creditCode,
            ret.dc,
            ret.betSetting,
        );

        Object.keys(commonConfig).forEach((key) => {
            ret[key] = commonConfig[key];
        });

        // 版號
        const d_p = (utils.checkENV(self.app, 'development') ? ' d' : ' p');
        ret.version = versionConfig['version'] + d_p;
        ret.version_date = versionConfig['date'];

        const accountController = this.app.controllers['account'];
        const rpc = accountController.getRemoteLoginSvr(gameId);
        const rpcLoginRet = await
            P.promisify(rpc.login, rpc)(playerId, ret, session.frontendId, gameId, ret.betSetting);

        // ret.login = rpcLoginRet;

        if (!rpcLoginRet) {
            throw new Error("RPC Login Failure: Empty Response");
        }

        for (let k in rpcLoginRet) {
            ret[k] = rpcLoginRet[k];
        }

        await this.twLoginSession(session, msg, ret, this.app);

        /*
        // 刪除前端用不到的data
        const delKeys = ['balance', 'domainSetting', 'avatarUrl', 'clientType', 'HallId', 'UpId', 'dc', 'isPromo', 'token',
            'ip', 'gameServerId', 'gameId', 'tableId', 'isMobile', 'os', 'accountState', 'MySQLWallet', 'error', 'osVersion',
            'browser', 'browserVersion', 'creditCode', 'userName', 'roundID', 'betSetting'
        ];
        for (let key of delKeys) {
            delete resp[key];
        }
        */


        Ret.data(next, ret);
    } catch (ex) {
        Ret.error(next, "twLogin error", ex);
    }
}


// 透過 API 踢玩家下線，有帶Cid 的話 直接讀取fish_hunter_player的 gameId 直接踢
proto.logout = cort(function* (msg, session, next) {

    try {
        if (typeof msg.Cid == 'undefined' || !msg.hasOwnProperty("Cid")) {
            return next(null, {error_code: C.ERROR, error_message: `Not find params: Cid`});
        }
        let self = this;
        let entryRemote = self.app.rpc.connector.accountRemote;
        let player;
        let reason = !_.isArray(msg.Cid) ? 'api kick player successed.' : 'api kick all players successed.';
        // 給前端踢人原因
        let reason_code;
        if (msg.hasOwnProperty("kickReason")) {
            if (msg.kickReason === C.SYSTEM_MAINTENANCE) {
                reason_code = C.SYSTEM_MAINTENANCE
            }
        } else {
            reason_code = reason;
        }

        let reData = {
            error_code: C.OK,
            error_message: reason,
            count: 0,
        }

        let playerIds = [];
        // 踢出單一個玩家
        if (!_.isArray(msg.Cid)) {
            playerIds.push(msg.Cid);
        }
        // 踢出所有玩家
        else playerIds = yield self.app.controllers.player.getSessionOnlinePlayers();

        for (let pId of playerIds) {
            // TODO: 未來多開，後台踢玩家: 要可指定某款遊戲 ex. 10001
            player = yield self.app.memdb.goose.transactionAsync(function () {
                return self.app.models.FishHunterPlayer.findByIdReadOnlyAsync(pId);
            }, self.app.getServerId());

            if (!player || !player.connectorId) continue;
            reData.count++;
            // 清除快取請求防禦紀錄
            self.app.controllers.fishHunterCache.clearAllRequestData(pId, player.gameId);
            P.promisify(entryRemote.kickSync, entryRemote)({frontendId: player.connectorId}, pId, player.gameId, reason_code);
        }

        // 踢單一玩家: 玩家不在線上
        if (!_.isArray(msg.Cid) && reData.count <= 0) {
            reData.error_code = C.ERROR;
            reData.error_message = 'Player is offline.';
        }

        Ret.data(next, reData);
    } catch (ex) {
        Ret.error(next, "", ex);
    }


});

// 透過 API 搜尋所有玩家
proto.allOnlinePlayers = cort(function* (msg, session, next) {
    try {
        let self = this;
        const onlinePlayers = yield self.app.controllers.player.getSessionOnlinePlayers();
        return Ret.data(next, onlinePlayers);
    } catch (ex) {
        return Ret.error(next, "", ex);
    }
});

// 取得線上玩家人數列表
// 回傳 {ggId, nums: (gameId -> (dc -> (agentId -> [playerId])))}
proto.getOnlinePlayerNums = function (msg, session, next) {
    let connectors = this.app.getServersByType('connector');
    let accountRemote = this.app.rpc.connector.accountRemote;
    let paramDefinConfig = this.app.controllers.fishHunterConfig.getParamDefinConfig();
    let ggId = paramDefinConfig.game_ggid;

    P.coroutine(function* () {
        let nums = {};
        for (let connector of connectors) {
            let res = yield P.promisify(accountRemote.getOnlinePlayerNums)({frontendId: connector.id});
            for (let gameId in res) {
                nums[gameId] = nums[gameId] || {};
                for (let dc in res[gameId]) {
                    nums[gameId][dc] = nums[gameId][dc] || {};
                    for (let agentId in res[gameId][dc]) {
                        nums[gameId][dc][agentId] = nums[gameId][dc][agentId] || [];
                        nums[gameId][dc][agentId].push(...res[gameId][dc][agentId])
                    }
                }
            }
        }
        return {ggId, nums: nums};
    })().then(function (r_data) {
        next(null, r_data);
    }).catch(function (err) {
        logger.warn('[accountHandler][getOnlinePlayerNums] err: ', err);
        next(null, {code: C.ERROR, ggId, nums: {}});
    });
}

proto.enter = function (msg, session, next) {

    try {
        this.app.controllers.debug.client(msg, session);
        let uid = msg.uid;
        let rid = msg.rid;

        let sessionService = this.app.get('sessionService');

        //duplicate log in
        if (!!sessionService.getByUid(uid)) {
            next(null, {
                code: C.ERROR,
                error: true
            });
            return;
        }

        session.bind(uid);
        session.set('rid', rid);
        session.on('closed', this.onUserLeave.bind(this, this.app));

        session.push('rid', function (err) {
            if (err) {
                console.error('set rid for session service failed! error is : %j', err.stack);
            }
        });


        this.app.rpc.fishHunterBackend.areaRemote.joinChannel(rid, uid, this.app.getServerId(), rid, true, function (res) {
            next(null, {code: C.OK, time: Date.now(), msg: res});
        });
    } catch (ex) {
        Ret.error(next, "", ex);
    }


}

proto.onUserLeave = function (app, session) {
    this.app.controllers.debug.client(msg, session);
    if (!session || !session.uid) return;
    app.rpc.fishHunterBackend.areaRemote.leaveChannel(session.get('rid'), session.uid, this.app.get('serverId'), session.get('rid'), function (res) {

    });
};

proto.echoRP = function (msg, session, next) {
    try {
        this.app.controllers.debug.client(msg, session);
        next(null, {code: C.OK, time: Date.now(), msg: msg});
    } catch (ex) {
        Ret.error(next, "", ex);
    }

}
