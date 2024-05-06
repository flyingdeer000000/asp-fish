'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('fire', __filename);
let utils = require('../utils/utils');
const uuid = require('uuid/v1');
let m_bShowTimeGap = false;

let Controller = function (app) {
    this.app = app;
    this.opsFT1Counter = utils.rateCounter();
    this.opsFT2Counter = utils.rateCounter();
    this.opsFT3Counter = utils.rateCounter();

    this.timeCounter = utils.timeCounter();     //時間計數器
    this.tpsCounter = utils.rateCounter();
    // if (this.app.get('env') == 'development')
    // if (this.app.get('env') == 'production')
    m_bShowTimeGap = true;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto.onFireAsync = cort(function* (player, params, areaPlayer, currency, cannon, cost, betSetting) {
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) dt = Date.now();
    try {
        let self = this;
        let playerId = player._id;
        let gameId = player.gameId;
        let tableLevel = player.tableLevel;
        let bulletId = params.bulletId;
        let funName = `playerId: ${playerId}, gameId: ${gameId} [onFireAsync]`;

        let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
        if (!memWallet) {
            return {error: C.ERROR};
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 1); // 驗證耗時用

        // 檢查玩家餘額扣除掉未送出的 cost 是否足夠繼續，若不足不給onFire，讓畫面看起來像Lag
        let checkLagFire = memWallet.checkLag(cost);
        if (checkLagFire) return {error: C.FAILD};

        let beforeBalance = memWallet.getRealBalance();

        let res = memWallet.bet(Math.abs(cost));
        if (!res) {
            logger.warn('[onFire][onFireAsync][memWallet.bet] ', JSON.stringify({
                // code:           res.code,
                playerId: player._id,
                areaId: player.areaId,
                params: params,
                cost: cost,
            }));
            return {error: C.PLAYER_OUT_GOLD};
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 2); // 驗證耗時用

        memWallet.updateFireTime();

        let level = 0;
        let level_length = cannon.level.length;
        for (let i = 0; i < level_length; i++) {
            if (cost <= cannon.level[i]) {
                level = i;
                break;
            }
        }

        let bulletData = { // bulletHistory: 存子單的資料
            createTime: utils.timeConvert(Date.now()),
            areaId: player.areaId,
            playerId: playerId,
            bulletId: bulletId,
            cost: res.score,
            lockTargetId: params.lockId,
            chairId: areaPlayer.chairId,
            alive: 1,
            denom: res.ratio,
            shootType: _.isString(level) ? level : 'normal',
            level: level,
            gameId: gameId,
            cash: res.cash
        };

        let bullet = self.app.controllers.fishHunterCache.bulletSpawn(playerId, _.cloneDeep(bulletData));
        //新增一個飛行中的子彈
        let insertId = yield self.app.controllers.bullet.AddFlyingBullet(bulletData);
        if (!bullet) return {error: C.ERROR};

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 3); // 驗證耗時用

        let creditAmount = memWallet.getRealBalance();//yield self.app.controllers.fishHunterPlayer.getCreditAmount(data.tokens, player.isSingleWallet);
        // 送更新餘額給前端
        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
            pid: playerId,
            balance: memWallet.getRealTokens()
        }, false);

        //設定子彈為發射完成(已扣完錢)的狀態
        yield self.app.controllers.bullet.setFireComplete(insertId, bulletId, beforeBalance, creditAmount, playerId);

        // 試玩帳號 押注 不進rc統計
        if (!player.demo)
            self.app.controllers.fishHunterRC.addRecord(currency, gameId, tableLevel, Math.abs(cost), self.app.controllers.fishHunterRC.RC_EVENT.COST, player.dc, betSetting.exchangeRate);

        let obj = {
            bullet: {
                playerId: bulletData.playerId,
                bulletId: bulletData.bulletId,
                angle: params.angle,
                cost: cost,
                lockTargetId: params.lockId,
                chairId: areaPlayer.chairId,
                alive: 1,
                level: bulletData.level,
                shootType: params.shootType != '' ? params.shootType : params.level
            }
        };
        if (params.hasOwnProperty("position")) obj.bullet['position'] = params.position; // 前端作為判斷飛機子彈位置

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 4); // 驗證耗時用
        // self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.FIRE, obj, false);
        return {error: null, obj};
    } catch (err) {
        logger.error('[onFire][onFireAsync] playerId: %s, params: %s, err: ', player._id, JSON.stringify(params), err);
        return {error: C.FAILD};
    }
});

proto.onWeaponShootAsync = cort(function* (player, params, areaPlayer, gameServerId) {
    // 驗證耗時用
    let dt = 0;
    if (m_bShowTimeGap) dt = Date.now();
    try {
        let self = this;
        const bulletId = params.bulletId;
        let areaId = player.areaId;
        let playerId = player._id;
        let funName = `playerId: ${playerId}, gameId: ${player.gameId} [onWeaponShootAsync]`;

        const paramDefinConf = self.app.controllers.fishHunterConfig.getParamDefinConfig();

        let cache = self.app.controllers.fishHunterCache;
        let areaPlayerDao = self.app.controllers.daoMgr.getAreaPlayerDao();
        let res = yield areaPlayerDao.weaponShootAsync(player.areaId, playerId, bulletId, params.level, gameServerId, paramDefinConf.weaponContrast);
        if (!res) {
            self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.PLAYER_WEAPON_NOT_EXIST);
            return {error: C.PLAYER_WEAPON_NOT_EXIST};
        }

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 1); // 驗證耗時用

        areaPlayer = res.areaPlayer;
        let {cost, alive, getBulletId, weaponCount} = res;

        let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, player.gameId);
        if (!memWallet) return {error: C.ERROR};

        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 2); // 驗證耗時用


        memWallet.updateFireTime();

        let bulletData = { // bulletHistory: 存子單的資料
            _id: utils.shortid(),
            createTime: utils.timeConvert(Date.now()),
            areaId: areaId,
            playerId: playerId,
            bulletId: bulletId,
            cost: cost,
            gain: 0,
            lockTargetId: params.lockId || 0,
            chairId: areaPlayer.chairId,
            level: params.level,
            shootType: params.level,
            denom: areaPlayer.denom,
            alive: alive,
            getBulletId: getBulletId,
            gameId: player.gameId,
            sourceWid: res.sourceWid,
        };

        if (params.level === consts.FishType.BAZOOKA) {
            cache.bulletSpawn(playerId, _.cloneDeep(bulletData)); // 新增一個飛行中的子彈 cache (for bazooka)
        }

        let treasure = _.cloneDeep(bulletData);
        treasure.actualAlive = bulletData.alive;
        cache.addTreasure(playerId, bulletId, treasure);

        yield self.app.controllers.bullet.AddFlyingWeaponBullet(bulletData, player.wId);//寫入子彈歷史=>特殊武器=>飛行中

        let obj = {
            bullet: {
                playerId: playerId,
                bulletId: bulletId,
                angle: params.angle,
                cost: 0,
                lockTargetId: params.lockId,
                chairId: areaPlayer.chairId,
                alive: bulletData.alive,
                level: bulletData.level,
                shootType: params.level
            }
        }

        if (params.hasOwnProperty("position")) obj.bullet['position'] = params.position; // 前端作為判斷飛機子彈位置

        if (params.level == consts.FishType.BAZOOKA) {
            obj.bullet['alive'] = 1;
            obj.bullet['gunEx'] = {bazooka: weaponCount};
        }
        // self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.FIRE, obj, false);
        if (m_bShowTimeGap) dt = utils.checkTimeGap(dt, funName, 3); // 驗證耗時用

        return {error: null, obj};
    } catch (err) {
        logger.error('[onFire][onWeaponShootAsync] player: %s, err: ', JSON.stringify(player), err);
        return {error: C.FAILD};
    }
});
