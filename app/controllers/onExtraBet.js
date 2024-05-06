'use strict';
let _ = require('lodash');  //js 的工具库，提供一些操作 数组，对象的方法等等
let quick = require('quick-pomelo');
let P = quick.Promise;
let C = require('../../share/constant');
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('extraBet', __filename);
let utils = require('../utils/utils');

let Controller = function (app) {
    this.app = app;
    this.opsFT1Counter = utils.rateCounter();
    this.opsFT2Counter = utils.rateCounter();
    this.opsFT3Counter = utils.rateCounter();

    this.timeCounter = utils.timeCounter();     //時間計數器
    this.tpsCounter = utils.rateCounter();
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto.onExtraBetAsync = cort(function* (player, areaPlayer, currency, cost, betSetting, extraBetTime) {
    try {
        let self = this;
        let playerId = player._id;
        let gameId = player.gameId;
        let tableLevel = player.tableLevel;
        let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
        if (!memWallet) return {error: C.ERROR};
        let bet = utils.number.divide(cost, extraBetTime);

        // 驗證額度
        let beforeBalance = memWallet.getRealBalance();
        let res = memWallet.bet(Math.abs(cost));
        if (!res) {
            logger.warn('[onExtraBet][onExtraBetAsync][memWallet.bet] ', JSON.stringify({
                playerId: player._id,
                areaId: player.areaId,
                cost: cost,
            }));
            return {error: C.PLAYER_OUT_GOLD};
        }
        memWallet.updateFireTime();

        // bulletHistory: 存子單的資料
        let bulletId = Date.now();
        let bulletData = {
            createTime: utils.timeConvert(bulletId),
            areaId: player.areaId,
            playerId: playerId,
            bulletId: bulletId,
            cost: bet,        // 為了計算正確
            chairId: areaPlayer.chairId,
            alive: extraBetTime,
            denom: res.ratio,
            shootType: 'extraBet',
            gameId: gameId,
            cash: utils.scoreToCash(bet, res.ratio),
        };

        // 新增一個飛行中的子彈
        let bullet = self.app.controllers.fishHunterCache.bulletSpawn(playerId, _.cloneDeep(bulletData));
        if (!bullet) return {error: C.ERROR};
        let insertId = yield self.app.controllers.bullet.AddFlyingBullet(bulletData);

        // 送更新餘額給前端
        let creditAmount = memWallet.getRealBalance();
        self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
            pid: playerId,
            balance: memWallet.getRealTokens()
        }, false);

        //設定子彈為發射完成(已扣完錢)的狀態
        yield self.app.controllers.bullet.setFireComplete(insertId, bulletId, beforeBalance, creditAmount, playerId);

        // 試玩帳號 押注 不進rc統計
        if (!player.demo)
            self.app.controllers.fishHunterRC.addRecord(currency, gameId, tableLevel, Math.abs(cost), self.app.controllers.fishHunterRC.RC_EVENT.COST, player.dc, betSetting.exchangeRate);

        return {error: C.OK, bulletId};
    } catch (err) {
        logger.error('[onExtraBet][onExtraBetAsync] playerId: %s, params: %s, err: ', player._id, err);
    }
});

