let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('area', __filename);
let C = require('../../../../share/constant');
let consts = require('../../../../share/consts');
let utils = require('../../../utils/utils');

let Remote = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Remote(app);
};

let proto = Remote.prototype;
let cort = P.coroutine;

// proto.updateAreaSceneTimeDelay = function (areaId, killShowTime, cb) {
//     let self = this;
//     P.resolve(0)
//         .then(() => {
//             let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
//             if (!area) return {};
//             if (area.stage === consts.AreaStage.WAIT) return {}; // 已經在換場就不需處理 Delay Time
//             // 新的換場 Delay 時間 = (計算該場開場多久) + 死亡動畫秒數
//             area.changeSceneTimeDelay = (Date.now() - area.sceneTimer) + killShowTime;
//             return {};
//         })
//         .catch(err => {
//             logger.error('[areaRemote][updateAreaSceneTimeDelay] areaId: %s, killShowTime: %s, err: ', areaId, killShowTime, err);
//             return { code: C.ERROR, reason: err };
//         })
//         .nodeify(cb);
// };

proto.addDelayBulletId = function (playerId, bulletId, cost, gain, getWeapon, cb) {
    let self = this;
    P.resolve(0)
        .then(() => {
            self.app.controllers.fishHunterCache.addDelayBulletId(playerId, bulletId, cost, gain, getWeapon);
            return {};
        })
        .catch(err => {
            logger.error('[areaRemote][handlerDelayBullet] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
            return {code: C.ERROR, reason: err};
        })
        .nodeify(cb);
};

// proto.setDoneOrAddWeaponId = function (playerId, bulletId, cost, weaponType, gain, bomb, cb) {
//     let self = this;
//     P.resolve(0)
//         .then(() => {
//             self.app.controllers.fishHunterCache.setDoneOrAddWeaponId(playerId, bulletId, cost, weaponType, gain, bomb);
//             return {};
//         })
//         .catch(err => {
//             logger.error('[areaRemote][setDoneOrAddWeaponId] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
//             return { code: C.ERROR, reason: err };
//         })
//         .nodeify(cb);
// };

proto.colliderHandler = function (player, bullet, fishes, angles, debugData, betSetting, extraBetTime, forceNoDie, cb) {
    logger.debug('colliderHandler ', player._id, ' bullet ', bullet, ' fishes ', fishes);

    const self = this;
    const colliderCtrl = this.app.controllers.colliderService;
    const treasureCtrl = this.app.controllers.treasure;
    P.resolve(0)
        .then(data => {
            if (!!player.gameServerId) {
                return self.app.memdb.goose.transactionAsync(function () {
                    return colliderCtrl._onKillFishCheck(player, bullet, fishes, angles, debugData, betSetting, extraBetTime, forceNoDie)
                        .then((data) => {
                            return data;
                        });
                }, self.app.getServerId());
            } else {
                return P.reject('player quit game ' + player._id);
            }
        })
        .then(data => {
            return colliderCtrl.checkScreenPause(data, player);
        })
        .then(data => {
            return treasureCtrl._checkTreasureAsync(data, player, bullet, betSetting);
        })
        .then(data => {
            return colliderCtrl._onColliderAsync(player, bullet, data);
        })
        .catch(err => {
            logger.error('[areaRemote][colliderHandler] playerId: %s, bullet: %s, fishes: %s, err: ',
                player._id, JSON.stringify(bullet), fishes, err);
            return {error: C.ERROR, reson: err};
        })
        .nodeify(cb);
};

proto.getRandomFishesDie = function (hitresult, totalBonus, tableLevel, cost, gameId, fishRealType, fishState, player, killFirst, cb) {
    let self = this;
    P.resolve(0)
        .then(() => {
            return self.app.controllers.fishHunterGame.randomFishesDie(hitresult, totalBonus, tableLevel, cost, gameId, fishRealType, fishState, player, killFirst);
        })
        .catch(err => {
            logger.error(`[areaRemote][getRandomFishesDie] playerId: ${player._id}, gameId: ${gameId}, totalBonus: ${totalBonus}, cost: ${cost}, tableLevel: ${tableLevel}, fishRealType: ${fishRealType}, fishState: ${fishState}, player: ${JSON.stringify(player)}, err: `, err);
            return null;
        })
        .nodeify(cb);
};

proto.getOnlinePlayers = function (cb) {
    let self = this;
    P.resolve(0)
        .then(() => {
            return self.app.controllers.fishHunterCache.getOnlinePlayers();
        })
        .catch(err => {
            logger.error(`[areaRemote][getOnlinePlayers] serverId: ${self.app.getServerId()}, err: `, err);
            return null;
        })
        .nodeify(cb);
};
