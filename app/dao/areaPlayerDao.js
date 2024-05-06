/**
 * Created by GOGA on 2019/6/18.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('dao', __filename);
const uuid = require('uuid/v1');
let util = require('util');
let utils = require('../utils/utils');
let consts = require('../../share/consts')

module.exports = memdbDao = function (app) {
    this.app = app;
    this.name = 'AreaPlayerDao'
}

let proto = memdbDao.prototype;
let cort = P.coroutine;

proto.findOneAsync = function (areaId, playerId, readOnly, shardId) {
    let app = this.app;

    if (!shardId) {
        logger.error('[areaPlayerDao][findOneAsync] input = %s', util.inspect({
            areaId,
            playerId,
            readOnly,
            shardId
        }, false, 10));

        // P.reject('shard is null');
    }

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayer = app.models.FishHunterAreaPlayers;
        let opts = {areaId, playerId}

        if (readOnly) {
            return modelAreaPlayer.findOneReadOnlyAsync(opts);
        } else {
            return modelAreaPlayer.findOneAsync(opts);
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.findOneAsync `, err);
            return null;
        })
}

proto.removeAsync = function (areaId, playerId, shardId) {
    logger.info(`${this.name}.removeAsync areaPlayer areaId:${areaId}, playerId:${playerId}`);

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayer = app.models.FishHunterAreaPlayers;
        let opts = {areaId, playerId}

        let rec = yield modelAreaPlayer.findOneAsync(opts);
        logger.info('[areaPlayerDao][removeAsync] areaPlayer remove before: ', rec);
        if (!!rec) {
            yield rec.removeAsync();
        }
        return rec;
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.removeAsync `, err);
            return null;
        })
}

proto.updateOneAsync = function (areaId, playerId, data, shardId) {
    let app = this.app;

    if (!shardId) {
        logger.error('updateOneAsync ', util.inspect({areaId, playerId, data}, false, 10));

        P.reject('shard is null');
    }

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayer = app.models.FishHunterAreaPlayers;
        let opts = {areaId, playerId};

        let areaPlayer = yield modelAreaPlayer.findOneAsync(opts);

        if (!areaPlayer) {
            return null;
        }

        modelAreaPlayer.getUpdatableKeys().forEach(k => {
            if (data.hasOwnProperty(k)) {
                areaPlayer[k] = data[k];
            }
        })


    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.updateOneAsync `, err);
            return null;
        })
}

proto.weaponShootAsync = function (areaId, playerId, bulletId, level, shardId, weaponContrast) {
    let app = this.app;

    if (!shardId) {
        logger.error('weaponShootAsync ', util.inspect({areaId, playerId, bulletId, level}, false, 10));

        P.reject('shard is null');
    }

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayer = app.models.FishHunterAreaPlayers;
        let opts = {areaId, playerId}

        let areaPlayer = yield modelAreaPlayer.findOneAsync(opts);
        let weaponCount = 0;

        if (!areaPlayer) {
            logger.info(`[areaPlayerDao][weaponShootAsync] playerId: ${playerId}, areaPlayer is ${areaPlayer}`);
            return null;
        }

        weaponCount = areaPlayer.gunEx[weaponContrast[level]] -= 1;
        if (weaponCount < 0) {
            logger.warn(`[areaPlayerDao][weaponShootAsync] playerId: ${playerId}, weaponCount is ${weaponCount}, weaponType: ${level}, gunEx: `, areaPlayer.gunEx);
            return null;
        }

        let cost = 0;
        let alive = 0;
        let getBulletId = null;
        let sourceWid = null;
        for (let i = 0; i < areaPlayer.gunInfo.length; i++) {
            // 找到最先取得的特殊武器，存入bulletId: 先進先出
            // 確認武器型態與前端送進來的相同 && 剩餘子彈數量 > 0 (for bazooka)
            if (areaPlayer.gunInfo[i].type == level && areaPlayer.gunInfo[i].alive > 0) {
                // 如果是 炸彈蟹 || 連環炸彈蟹，因為前端會連續送 onFire 所以須過濾已經 onFire 過的(bulletId>0)
                if ((level == consts.FishType.BOMB_CRAB || level == consts.FishType.SERIAL_BOMB_CRAB) && areaPlayer.gunInfo[i].bulletId > 0) continue;
                areaPlayer.gunInfo[i].bulletId = bulletId;
                alive = areaPlayer.gunInfo[i].alive; // 取出獲得子彈數量
                cost = areaPlayer.gunInfo[i].cost; // 取出當下獲得免費武器的成本
                getBulletId = areaPlayer.gunInfo[i].getBullet[0].bid; // 取出當時獲得免費武器的子彈ID // 先進先出，從陣列 0 開始
                sourceWid = areaPlayer.gunInfo[i].sourceWid; // 取出當下獲得免費子時的 wid // 來源 wid
                if (level == consts.FishType.BAZOOKA) {
                    --areaPlayer.gunInfo[i].getBullet[0].alive; // 該批獲得的免費子彈扣除
                    areaPlayer.gunInfo[i].alive -= 1; // 機關炮扣一顆 fire 子彈數
                    if (areaPlayer.gunInfo[i].getBullet[0].alive <= 0) {
                        areaPlayer.gunInfo[i].getBullet.splice(0, 1); // 該批獲得的免費子彈使用完畢，移除
                    }
                }

                break;
            }
        }
        areaPlayer.lastFireTime = Date.now();
        areaPlayer.markModified('gunEx');
        areaPlayer.markModified('gunInfo');
        yield areaPlayer.saveAsync();

        return {areaPlayer, cost, alive, getBulletId, weaponCount, sourceWid};

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.weaponShootAsync `, err);
            return null;
        })
}

proto.clearGunInfoAsync = function (areaId, playerId, isBazooka, bulletId, cost, shardId) {
    let app = this.app;

    if (!shardId) {
        logger.error('clearGunInfoAsync ', util.inspect({areaId, playerId, isBazooka, bulletId, cost}, false, 10));

        P.reject('shard is null');
    }

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelAreaPlayer = app.models.FishHunterAreaPlayers;
        let opts = {areaId, playerId}

        let areaPlayer = yield modelAreaPlayer.findOneAsync(opts);

        if (!areaPlayer) {
            return null;
        }

        if (isBazooka) {
            for (let i in areaPlayer.gunInfo) {
                if (areaPlayer.gunInfo[i].type == consts.FishType.BAZOOKA && cost == areaPlayer.gunInfo[i].cost) {
                    areaPlayer.gunInfo.splice(i, 1);
                    break;
                }
            }
        } else {
            for (let i in areaPlayer.gunInfo) {
                if (bulletId == areaPlayer.gunInfo[i].bulletId) {
                    areaPlayer.gunInfo.splice(i, 1);
                    break;
                }
            }
        }

        areaPlayer.markModified('gunInfo');
        yield areaPlayer.saveAsync();

        return areaPlayer;
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.clearGunInfoAsync `, err);
            return null;
        })
}
