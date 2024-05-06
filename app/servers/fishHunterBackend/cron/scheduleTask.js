let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('fire', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let utils = require('../../../utils/utils');
let util = require('util');


let Cron = function (app) {
    this.startupTime = Date.now();
    this.app = app;
};

module.exports = function (app) {
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

proto.handleCancelFire = cort(function* () {
    try {
        let self = this;
        let cache = this.app.controllers.fishHunterCache;
        let playerDatas = cache.getCancelFirePlayers(); // 取所有要取消bullet的玩家
        if (playerDatas.length === 0) return;
        let player;
        for (let cancelKey of playerDatas) {
            /* player = [
                playerId, areaId, tableId, gameId, tableLevel, isSingleWallet, isPromo, dc, currency
               ].join(':');
             */
            player = cancelKey.split(':');
            player = {
                _id: player[0],
                areaId: player[1],
                tableId: player[2],
                gameId: player[3],
                tableLevel: _.toNumber(player[4]),
                isSingleWallet: _.toNumber(player[5]),
                isPromo: player[6] == 'true' ? true : false,
                wId: '',
                dc: player[7],
                currency: player[8],
                exchangeRate: player[9]
            };
            // { '1590026861019':  10 }
            let bullets = _.cloneDeep(cache.getPlayerCancelBullets(cancelKey));

            let bulletIds = Object.keys(bullets);
            if (bulletIds.length === 0) continue;

            let totalCancelFireCost = 0;
            let rcCancelCost = 0;
            for (let bid of bulletIds) {
                if (!bullets[bid]) {
                    logger.error('[scheduleTask][handleCancelFire] Not find cancel bullet, playerId: %s, bulletId: %s, cost: %s, bullets: %s, bulletIds: %s', player._id, bid, bullets[bid], JSON.stringify(bullets), bulletIds);
                    continue;
                }

                rcCancelCost = utils.number.add(rcCancelCost, bullets[bid]);
                cache.delCancelBullets(cancelKey, bid);
                let delBullet_res = yield self.app.controllers.bullet.delCancelFire(player._id, bid);
                if (delBullet_res) {
                    // 有子單 && 刪除成功才返還 cost
                    totalCancelFireCost = utils.number.add(totalCancelFireCost, bullets[bid]);
                }
            }

            logger.info('[scheduleTask][handleCancelFire] playerId: %s, cancel totalCancelFireCost: %s, rcCancelCost: %s, bulletIds: ', player._id, totalCancelFireCost, rcCancelCost, bulletIds);
            // 試玩帳號 取消押注 不進rc統計 // 先加 RC 再取消押注
            if (!player.demo) {
                //因為cost已扣掉所以補回
                self.app.controllers.fishHunterRC.addRecord(player.currency, player.gameId, player.tableLevel, rcCancelCost, self.app.controllers.fishHunterRC.RC_EVENT.COST, player.dc, player.exchangeRate);
            }

            if (totalCancelFireCost > 0) {
                let memWallet = yield self.app.controllers.walletMgr.getWalletAsync(player._id, player.gameId);
                if (!!memWallet) {
                    memWallet.cancelFireCost(totalCancelFireCost, false, 1, (err, data) => {
                        if (!!err) {
                            logger.error('memWallet.cancelFireCost error ', util.inspect({
                                playerId: player._id,
                                gameId: player.gameId,
                                totalCancelFireCost
                            }, false, 10));
                        }
                    });

                    // 送更新餘額給前端
                    self.app.controllers.table.pushAsync(player.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
                        pid: player._id,
                        balance: memWallet.getRealTokens()
                    }, false);
                }
            }
        }
    } catch (err) {
        logger.error('[fishHunterBackend][scheduleTask][handleCancelFire] err: ', err);
    }
});

proto.singleWalletBalanceSync = function () {
    this.app.controllers.walletMgr.singleWalletBalanceSync();
}

