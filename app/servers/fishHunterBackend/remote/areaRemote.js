let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('fire', __filename);
let C = require('../../../../share/constant');
let utils = require('../../../utils/utils');


let Remote = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Remote(app);
};

let proto = Remote.prototype;
let cort = P.coroutine;

proto.destroyBullet = function (playerId, bulletId, cb) {
    let self = this;
    let controller = this.app.controllers.fishHunterGame;

    return self.app.memdb.goose.transaction(P.coroutine(function* () {
        try {
            logger.info('destroyBullet start ');
            let ret = yield controller._onDestroyBullet(playerId, bulletId);

            logger.info('destroyBullet end ');

            return ret;
        } catch (err) {
            logger.error('areaRemote destroyBullet catch err  ', err);
            return {error: C.ERROR};
        }
    }), self.app.getServerId())
        .nodeify(cb)
        .then(() => {
            self.app.event.emit('transactionSuccess')
        })
        .catch((err) => {
            self.app.event.emit('transactionFail');
            logger.info('areaRemote destroyBullet reject ', err);
        });
};

// proto.colliderSettlement = function (settlementData, cb) {
//     let self = this;
//     let controller = this.app.controllers.fishHunterGame;
//
//     return self.app.memdb.goose.transaction(P.coroutine(function* () {
//         try {
//             logger.info('colliderSettlement start ');
//             let ret = yield controller._onColliderSettlement(settlementData);
//
//             logger.info('colliderSettlement end ');
//
//             return ret;
//         }
//         catch (err) {
//             logger.error('areaRemote colliderSettlement catch err  ', err);
//             return { error: C.ERROR };
//         }
//     }), self.app.getServerId())
//         .nodeify(cb)
//         .then(() => {
//             self.app.event.emit('transactionSuccess')
//         })
//         .catch((err) => {
//             self.app.event.emit('transactionFail');
//             logger.info('areaRemote colliderSettlement reject ', err);
//         });
// };

proto.updateAreaPlayer = function (queryOrId, opts, cb) {
    let self = this;
    let controller = this.app.controllers.fishHunterGame;

    return self.app.memdb.goose.transaction(P.coroutine(function* () {
        try {

            let ret = yield controller._onUpdateAreaPlayer(queryOrId, opts);

            return ret;
        } catch (err) {
            logger.error('areaRemote updateAreaPlayer catch err  ', err);
            return {error: C.ERROR};
        }
    }), self.app.getServerId())
        .nodeify(cb)
        .then(() => {
            self.app.event.emit('transactionSuccess')
        })
        .catch((err) => {
            self.app.event.emit('transactionFail');
            logger.info('areaRemote updateAreaPlayer reject ', err);
        });
};

proto.spawnBullet = function (bulletData, cb) {
    let self = this;
    let controller = this.app.controllers.fishHunterGame;

    return self.app.memdb.goose.transaction(P.coroutine(function* () {
        try {

            let ret = yield controller._onSpawnBullet(bulletData);

            return ret;
        } catch (err) {
            logger.error('areaRemote spawnBullet catch err  ', err);
            return {error: C.ERROR};
        }
    }), self.app.getServerId())
        .nodeify(cb)
        .then(() => {
            self.app.event.emit('transactionSuccess')
        })
        .catch((err) => {
            self.app.event.emit('transactionFail');
            logger.info('areaRemote spawnBullet reject ', err);
        });
};

proto.collectGameTokensByArea = function (areaId, cb) {
    let self = this;
    let controller = this.app.controllers.fishHunterGame;

    return self.app.memdb.goose.transaction(P.coroutine(function* () {
        try {

            yield controller._onCollectGameTokensByArea(areaId);
        } catch (err) {
            logger.error('areaRemote collectGameTokensByArea catch err  ', err);
            return {error: C.ERROR};
        }
    }), self.app.getServerId())
        .nodeify(cb)
        .then(() => {
            self.app.event.emit('transactionSuccess')
        })
        .catch((err) => {
            self.app.event.emit('transactionFail');
            logger.info('areaRemote collectGameTokensByArea reject ', err);
        });
};

//ck:2019/6/28 - 玩家離場了->開始停止射擊->檢查剩餘已出現在場上但尚未擊中魚的子彈
proto.stopFire = function (player, gameId, areaId, gameServerId, betSetting, cb) {
    let controller = this.app.controllers.standUp;
    P.resolve(0)
        .then(() => {
            return controller.stopFireAsync(player, gameId, areaId, gameServerId, betSetting);
        })
        .catch((err) => {
            logger.error('[areaRemote][stopFire] playerId: %s, gameServerId: %s, err: ', player._id, gameServerId, err);
            return {error: C.ERROR};
        })
        .nodeify(cb);
}

proto.onExchange = function (playerId, gameId, betSetting, cb) {
    logger.info('onExchange', playerId, ' ', gameId)
    let self = this;
    let memWallet = null;

    P.resolve(0)
        .then(() => {
            return self.app.controllers.walletMgr.getWalletAsync(playerId, gameId, false, null, betSetting);
        })
        .then((data) => {

            if (!data) return null;

            memWallet = data;

            return memWallet.onExchangeAsync();
        })
        .then(data => {
            if (!data) {
                return {error: C.ERROR, balance: 0};
            } else {
                return {error: null, balance: memWallet.getRealBalance()};
            }
        })
        .catch(err => {
            logger.error('[areaRemote][onExchange] playerId: %s, gameId: %s, err: ', playerId, gameId, err);
            return {code: C.ERROR, reason: err};
        })
        .nodeify(cb);
};

proto.doExchange = function (playerId, gameId, delta, betSetting, cb) {
    logger.debug('[doExchange] playerId: %s, gameId: %s, data: %s', playerId, gameId, JSON.stringify(delta));
    let self = this;
    P.resolve(0)
        .then(() => {
            return self.app.controllers.walletMgr.getWalletAsync(playerId, gameId, false, null, betSetting);
        })
        .then((data) => {
            let memWallet = data;
            memWallet.amount = utils.number.add(memWallet.amount, Math.abs(delta));
            memWallet.quota = utils.number.sub(memWallet.quota, Math.abs(delta));
            return memWallet;
        })
        .then(data => {
            return {error: null, balance: data.getRealBalance()};
        })
        .catch(err => {
            logger.error('[areaRemote][doExchange] playerId: %s, gameId: %s, data: %s, err: ', playerId, gameId, JSON.stringify(delta), err);
            return {code: C.ERROR, err};
        })
        .nodeify(cb);
};


proto.joinChannel = function (uid, sid, name, flag, cb) {
    // let channel = this.app.get('channelService').getChannel(name, flag);
    // let username = uid;

    // if( !!channel) {
    // 	channel.add(uid, sid);
    // }

    this.app.get('globalChannelService').add(uid, sid);

    cb({uid: uid, sid: sid, name: name});
}

proto.leaveChannel = function (uid, sid, name, cb) {
    // let channel = this.app.get('channelService').getChannel(name, false);
    // // leave channel
    // if( !! channel) {
    // 	channel.leave(uid, sid);
    // }

    this.app.get('globalChannelService').leave(uid, sid);

    cb();
};

proto.handleBazooka = function (playerId, gameId, tableLevel, cost, alive, cb) {
    let self = this;

    P.resolve(0)
        .then(() => {
            return self.app.controllers.bullet.incrBazooka(playerId, gameId, tableLevel, cost, alive);
        })
        .catch((err) => {
            logger.error('[areaRemote][handleBazooka] playerId: %s, err: ', playerId, err);
            return {error: C.ERROR};
        })
        .nodeify(cb);
};

proto.getInitBullets = function (playerId, gameId, cb) {
    let self = this;

    P.resolve(0)
        .then(() => {
            return self.app.controllers.bullet.getInitBullets(playerId, gameId);
        })
        .catch((err) => {
            logger.error('[areaRemote][getInitBullets] playerId: %s, gameId: %s, err: ', playerId, gameId, err);
            return {error: C.ERROR};
        })
        .nodeify(cb);
};

// proto.getNoSendBullet = function (playerId, gameId, isSingleWallet, cb) {
//     let self = this;
//
//     P.resolve(0)
//         .then(() => {
//             return self.app.controllers.bullet.getNoSendBullet(playerId, gameId, isSingleWallet);
//         })
//         .catch((err) => {
//             logger.error('[areaRemote][getNoSendBullet] playerId: %s, gameId: %s, isSingleWallet: %s, err: ', playerId, gameId, isSingleWallet, err);
//             return { error: C.ERROR };
//         })
//         .nodeify(cb);
// };

proto.delBulletHistory = function (playerId, bulletId, cb) {
    let self = this;

    P.resolve(0)
        .then(() => {
            return self.app.controllers.bullet.delBulletHistory(playerId, bulletId);
        })
        .catch((err) => {
            logger.error('[areaRemote][delBulletHistory] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
            return {error: C.ERROR};
        })
        .nodeify(cb);
};

// proto.saveBulletHistory = function (bulletIds, player, oldWId, success, cb) {
//     let self = this;
//
//     P.resolve(0)
//         .then(() => {
//             return self.app.controllers.bullet.saveBulletHistory(bulletIds, player, oldWId, success);
//         })
//         .catch((err) => {
//             logger.error('[areaRemote][saveBulletHistory] bulletIds: %s, playerId: %s, gameId: %s, oldWId: %s, err: ', bulletIds, player._id, player.gameId, oldWId, err);
//             return { error: C.ERROR };
//         })
//         .nodeify(cb);
// };

proto.getWalletAsync = function (playerId, gameId, remove, wagerId, betSetting, cb) {
    let self = this;

    P.resolve(0)
        .then(() => {
            return self.app.controllers.walletMgr.getWalletAsync(playerId, gameId, remove, wagerId, betSetting);
        })
        .then((memWallet) => {
            if (!memWallet) return {error: C.ERROR};
            return {error: C.OK, data: {balance: memWallet.getRealBalance()}};
        })
        .catch((err) => {
            logger.error('[areaRemote][getWalletAsync] playerId: %s, gameId: %s, remove: %s, err: ', playerId, gameId, remove, err);
            return {error: C.ERROR};
        })
        .nodeify(cb);
};

proto.checkGameSettlementDone = function (playerId, gameId, reason, cb) {
    let controller = this.app.controllers.walletMgr;
    P.resolve(0)
        .then(() => {
            return controller.checkGameSettlementDone(playerId, gameId, reason);
        })
        .catch((err) => {
            logger.error(`[areaRemote][checkGameSettlementDone] playerId: ${playerId}, gameId: ${gameId}, reason: ${reason}, err:`, err);
            return true;
        })
        .nodeify(cb);
}

proto.clearCacheWhenPlayerOffLine = function (playerId, gameId, cb) {
    let self = this;
    P.resolve(0)
        .then(() => {
            return self.app.controllers.fishHunterCache.clearCacheWhenPlayerOffLine(playerId, gameId);
        })
        .catch((err) => {
            logger.error(`[areaRemote][clearCacheWhenPlayerOffLine] playerId: ${playerId}, gameId: ${gameId}, err:`, err);
            return true;
        })
        .nodeify(cb);
}
