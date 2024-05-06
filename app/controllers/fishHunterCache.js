'use strict';

let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
const uuid = require('uuid/v1');
let logger = quick.logger.getLogger('connector', __filename);
let consts = require('../../share/consts');
let C = require('../../share/constant');
let utils = require('../utils/utils');
let async = require('async');

const DB_BULLETS_INIT = 1;
const DB_BULLETS_PENDING = 2;

const DB_TREASURE = 7;

const DB_BULLET_HISTORY = 9;

const DB_FISH_AREAS = 10;
const DB_FISH_ALG_ARGS = 11;

const DB_ONLINE_PLAYERS = 13;
const DB_FISH_RTP = 14;
const DB_CANCEL_FIRE = 15;
const DB_BAZOOKA = 16;
const DB_API_AUTH = 17;
const DB_REQUEST_DEF = 21;
const DB_WALLET_BET_RESULT = 23;            //钱包扣款成败标志， 有获得武器的普通子弹才会存


const dbRehook = function (db) {
    if (!db) {
        return;
    }

    db.hdel = db.hdel || function (key, sub) {
        return db['hset'](key, sub, null);
    };

    db['hexists'] = function (key, field) {
        let obj = db.lookup(key);
        if (!!obj && 'hash' === obj.type) {
            return (field in obj.val);
        } else {
            return false;
        }
    };

}

const FishHunterCache = function (app) {
    const self = this;
    this.app = app;
    this.db = this.app.get('sync');
    // this is so ridiculous that there is no HDEL in that sync plugin of pomelo v.0.0.2,
    // and somehow they put it in the code?! they did it before by magic???
    dbRehook(this.db);
    this.utils = utils;
    this.timerIds = [];
};

module.exports = function (app) {
    return new FishHunterCache(app);
};

let proto = FishHunterCache.prototype;

FishHunterCache.prototype.start = function () {
    try {
        let self = this;

        async.auto({
            Init: function (finish) {
                let r_data = 0;
                self.init();
                finish(null, r_data);
            }
        }, function (errs, results) {

        });
    } catch (err) {
        logger.error('[fishHunterCache][start] catch err:', err);
    }
};

proto.init = function () {
    try {
        let self = this;
        let serverCnf = self.app.controllers.fishHunterConfig.getFishServerConfig();

        // 先定死
        let room = 'global';

        let gameId;
        let gameCount = serverCnf.fishGameId.length - 1;
        for (let i = 0; i <= gameCount; i++) {
            gameId = serverCnf.fishGameId[i];
            // 用裡面的set而已
            this.getFishAlgArgs({gameId}, room);
            this.getFishRTP(gameId, room);
        }
    } catch (err) {
        logger.error('[fishHunterCache][init] playerId: %s, bulletData: %s, err: ', playerId, JSON.stringify(bullet), err);
    }
}

// 定時檢查並清除過期快取
proto.cronClearCache = function (playerId, gameId) {
    try {
        let self = this;

        // const DB_BULLETS_INIT = 1;       存於fishHunterBackend
        // const DB_BULLETS_PENDING = 2;    存於fishHunterBackend
        // const DB_TREASURE = 7;           存於fishHunterBackend
        // const DB_BULLET_HISTORY = 9;     存於fishHunterBackend
        // const DB_API_AUTH = 17;          存於fishHunter，用完當下即刪除
        // const DB_REQUEST_DEF = 21;       存於connector、fishHunter、fishHunterBackend
        // const DB_BAZOOKA = 16;           存於fishHunterBackend
        // const DB_WALLET_BET_RESULT = 23; 存於fishHunterBackend
        self.clearCacheWhenPlayerOffLine(playerId, gameId);

        // const DB_FISH_AREAS = 10;        存於fishHunter，交給 fishHunter/cron/scheduleTask.timerLoop  _refreshArea 定時處理清除
        // const DB_FISH_ALG_ARGS = 11;     存於fishHunter，機率使用，不清除
        // const DB_ONLINE_PLAYERS = 13;    存於fishHunter，
        // const DB_FISH_RTP = 14;          存於fishHunter，機率使用，不清除
        // const DB_CANCEL_FIRE = 15;       存於fishHunterBackend，交給 fishHunterBackend/cron/scheduleTask.handleCancelFire 定時處理清除
    } catch (err) {
        logger.error('[fishHunterCache][cronClearCache] err: ', err);
    }
}

// proto.getBulletsInit = function (playerId, bulletId) {
//   this.db.selectDB(DB_BULLETS_INIT);
//   let bullet = null;
//   let bullets = this.db.get(playerId);
//   for(let i in bullets){
//     if(bullets[i].bulletId == bulletId){
//       bullet = bullets[i];
//       break;
//     }
//   }
//   if(!bullet){
//     return false;
//   }
//   return bullet;
// }

proto.bulletSpawn = function (playerId, bullet) {
    try {
        this.db.selectDB(DB_BULLETS_INIT);

        // // 檢查重複
        // let bullets = this.db.get(playerId);
        // for(let i in bullets){
        //   if(bullets[i].bulletId == bulletId){
        //     return false;
        //   }
        // }

        return this.db.sadd(playerId, bullet);
    } catch (err) {
        logger.error('[fishHunterCache][bulletSpawn] playerId: %s, bulletData: %s, err: ', playerId, JSON.stringify(bullet), err);
    }
}

// proto.getBulletsPending = function (playerId, bId) {
//   this.db.selectDB(DB_BULLETS_PENDING);
//   return this.db.hget(playerId, bId);
// }

proto.bulletSuspend = function (playerId, bullet) {
    try {
        this.db.selectDB(DB_BULLETS_INIT);
        this.db.sdel(playerId, bullet);

        this.db.selectDB(DB_BULLETS_PENDING);
        return this.db.sadd(playerId, bullet);
    } catch (err) {
        logger.error('[fishHunterCache][bulletSuspend] playerId: %s, bulletData: %s, err: ', playerId, JSON.stringify(bullet), err);
    }
}

proto.bulletBomb = function (playerId, bulletId) {
    try {
        this.db.selectDB(DB_BULLETS_PENDING);

        let bullet = null;
        let bullets = this.db.get(playerId);
        for (let i in bullets) {
            const one = bullets[i];
            if (!one) {
                continue;
            }
            if (one.bulletId === bulletId) {
                bullet = one;
                break;
            }
        }

        if (!bullet) {
            return false;
        }

        return this.db.sdel(playerId, bullet);
    } catch (err) {
        logger.error('[fishHunterCache][bulletBomb] playerId: %s, err: ', playerId, err);
    }
}

//for碰撞時遇到還沒扣款但已經來碰撞的子彈 =>先刪除cache的子彈但不處理憑證部分,憑證等離場時再判斷是否退款
proto.DestroyBullet = function (playerId, bulletId) {
    try {
        this.db.selectDB(DB_BULLETS_INIT);
        let bullet = null;
        let bullets = this.db.get(playerId);
        for (let i in bullets) {
            const one = bullets[i];
            if (one.bulletId === bulletId) {
                bullet = one;
                break;
            }
        }
        if (!bullet) {
            return false;
        }
        return this.db.sdel(playerId, bullet);
    } catch (err) {
        logger.error('[fishHunterCache][DestroyBullet] playerId: %s, err: ', playerId, err);
    }
}

proto.bulletData = function (playerId, bulletId, isPending) {
    if (isPending) {
        this.db.selectDB(DB_BULLETS_PENDING);
    } else {
        this.db.selectDB(DB_BULLETS_INIT);
    }

    let bullets = this.db.get(playerId);
    for (let i in bullets) {
        const one = bullets[i];
        if (!one) {
            continue;
        }
        if (one.bulletId === bulletId) {
            return bullets[i];
        }
    }

    return null;
}

proto.bullets = function (playerId, isPending) {
    try {
        if (isPending) {
            this.db.selectDB(DB_BULLETS_PENDING);
        } else {
            this.db.selectDB(DB_BULLETS_INIT);
        }

        let bullets = this.db.get(playerId);
        if (!bullets) {
            return [];
        }
        return bullets.filter((value) => {
            return !!value
        });
    } catch (err) {
        logger.error('[fishHunterCache][bullets] playerId: %s, err: ', playerId, err);
    }
}

proto.clearInitBullets = function (playerId) {
    this.db.selectDB(DB_BULLETS_INIT);
    return this.db.del(playerId);
}

proto.clearPendingBullets = function (playerId) {
    this.db.selectDB(DB_BULLETS_PENDING);
    return this.db.del(playerId);
}

proto.addTreasure = function (playerId, key, value) {
    try {
        this.db.selectDB(DB_TREASURE);

        if (this.db.hexists(playerId, key)) {
            return false;
        }

        return this.db.hset(playerId, key, value);
    } catch (err) {
        logger.error('[fishHunterCache][addTreasure] playerId: %s, bulletId: %s, data: %s, err: ',
            playerId, key, JSON.stringify(value), err);
    }
}

proto.getTreasure = function (playerId, key) {
    try {
        this.db.selectDB(DB_TREASURE);
        return this.db.hget(playerId, key);
    } catch (err) {
        logger.error('[fishHunterCache][getTreasure] playerId: %s, bulletId: %s, err: ', playerId, key, err);
    }
}

proto.getAllTreasure = function (playerId) {
    this.db.selectDB(DB_TREASURE);

    return this.db.hvals(playerId);
}

proto.delTreasure = function (playerId, key) {
    try {
        this.db.selectDB(DB_TREASURE);

        if (!this.db.hexists(playerId, key)) {
            return false;
        }

        return this.db.hdel(playerId, key);
    } catch (err) {
        logger.error('[fishHunterCache][delTreasure] playerId: %s, err: ', playerId, err);
    }
}

proto.clearTreasure = function (playerId) {
    this.db.selectDB(DB_TREASURE);
    return this.db.del(playerId);
}

proto.setFishArea = function (key, value) {
    try {
        this.db.selectDB(DB_FISH_AREAS);
        return this.db.hset('fishAreas', key, value);
    } catch (err) {
        logger.error('[fishHunterCache][setFishArea] areaId: %s, err: ', key, err);
    }
}

proto.findFishArea = function (key) {
    try {
        this.db.selectDB(DB_FISH_AREAS);
        return this.db.hget('fishAreas', key);
    } catch (err) {
        logger.error('[fishHunterCache][findFishArea] key: %s, err: ', key, err);
    }
}

proto.findFishAreaByField = function (field, expect) {
    try {
        this.db.selectDB(DB_FISH_AREAS);

        let areas = this.db.hvals('fishAreas');
        if (!areas) {
            return null;
        }

        for (let k in areas) {
            const area = areas[k];
            if (!area) {
                continue;
            }
            if (area[field] === expect) {
                return area;
            }
        }

        return null;
    } catch (err) {
        logger.error('[fishHunterCache][findFishAreaByField] tableId: %s, err: ', expect, err);
    }
}

proto.findAllFishArea = function () {
    try {
        this.db.selectDB(DB_FISH_AREAS);
        return this.db.hvals('fishAreas');
    } catch (err) {
        logger.error('[fishHunterCache][findAllFishArea] err: ', err);
    }
}

proto.delFishArea = function (key) {
    this.db.selectDB(DB_FISH_AREAS);

    if (!this.db.hexists('fishAreas', key)) {
        return false;
    }

    return this.db.hdel('fishAreas', key);
}

proto.setFishAlgArgs = function (gameId, room, value) {
    this.db.selectDB(DB_FISH_ALG_ARGS);

    if (!room) {
        room = 'global';
    }
    return this.db.hset(gameId, room, value);
}
proto.getFishAlgArgs = function (player, room) {
    try {
        this.db.selectDB(DB_FISH_ALG_ARGS);

        if (!!player && player.isPromo) {
            return 'special';
        }

        if (!room) {
            room = 'global';
        }
        // 先定死
        room = 'global';

        if (!this.db.exists(player.gameId)) {
            this.db.hset(player.gameId, room, null);
            return null;
        }

        return this.db.hget(player.gameId, room);
    } catch (err) {
        logger.error('[fishHunterCache][getFishAlgArgs] player: %s, tableLevel: %s, err: ', JSON.stringify(player), room, err);
    }
}
// proto.getFishAlgArgs = function () {
//   try {
//     let res = 'normal';
//
//     return res;
//   } catch (err) {
//     logger.error('[fishHunterCache][getFishAlgArgs] err: ', err);
//     return 'normal';
//   }
// }
proto.getFishAlgKeys = function () {
    this.db.selectDB(DB_FISH_ALG_ARGS);

    return this.db.keys('*');
}

proto.clearCacheWhenPlayerOffLine = function (playerId, gameId) {
    try {
        // 清除快取子彈紀錄
        this.clearInitBullets(playerId);            // 清 DB_BULLETS_INIT
        // 清除快取子彈紀錄
        this.clearPendingBullets(playerId);         // 清 DB_BULLETS_PENDING
        // 清除快取treasure紀錄
        this.clearTreasure(playerId);               // 清 DB_TREASURE
        // 清除快取bazooka資料
        this.delBazookaTreasure(playerId);          // 清 DB_TREASURE
        // 清除快取子彈紀錄
        this.delAllBulletHistory(playerId, gameId); // 清 DB_BULLET_HISTORY
        // 清除快取呼叫api紀錄
        this.delAllApiAuthInfo(playerId, gameId);   // 清 DB_API_AUTH
        // 清除快取請求防禦紀錄
        this.clearAllRequestData(playerId, gameId); // 清 DB_REQUEST_DEF
        // 清除快取bazooka紀錄
        this.delBazookaAlive(playerId);             // 清 DB_BAZOOKA
        // 清除快取b子彈扣款紀錄
        this.clearBetResult(playerId);              // 清 DB_TREASUREDB_WALLET_BET_RESULT

        return true;
    } catch (err) {
        logger.error('[fishHunterCache][clearCacheWhenPlayerOffLine] playerId: %s, err: ', playerId, err);
        return false;
    }
}

// 增加在線玩家
proto.addOnlinePlayers = function (playerId, connectorId, accountInfo) {
    try {
        this.db.selectDB(DB_ONLINE_PLAYERS);
        return this.db.hset('onlinePlayers', playerId, {
            connectorId,
            gameState: consts.GameState.FREE,
            gameId: accountInfo.gameId,
            loginIp: accountInfo.ip,
            isSingleWallet: accountInfo.isSingleWallet,
            updateTime: Date.now(),
            updateSingleWalletBalanceTime: Date.now(),
            updateSingleBetAndWinDelayTime: Date.now(),
            specialKeepAliveTime: Date.now(),
            dc: accountInfo.dc,
            currency: accountInfo.creditCode,
            // 域名設定使用的dc
            dsUseDc: accountInfo.domainSetting.useDc,
        });
    } catch (err) {
        logger.error('[fishHunterCache][addOnlinePlayers] playerId: %s, err: ', playerId, err);
    }
}

// 取得在線玩家
proto.getOnlinePlayers = function (playerId) {
    try {
        this.db.selectDB(DB_ONLINE_PLAYERS);

        let onlinePlayers;
        if (!playerId) {
            onlinePlayers = this.db.hvals('onlinePlayers');
            if (!onlinePlayers) return false;
            if (!Object.keys(onlinePlayers).length) return false;
        } else {
            if (!this.db.hexists('onlinePlayers', playerId)) return false;
            onlinePlayers = this.db.hget('onlinePlayers', playerId);
        }

        return onlinePlayers;
    } catch (err) {
        logger.error('[fishHunterCache][getOnlinePlayers] err: ', err);
    }
}

// 更新在線玩家遊戲狀態
proto.updatePlayerGameState = function (playerId, gameState) {
    try {
        this.db.selectDB(DB_ONLINE_PLAYERS);

        if (!this.db.hexists('onlinePlayers', playerId)) return false;

        let player = this.db.hget('onlinePlayers', playerId);
        player.gameState = gameState;
        player.updateTime = Date.now();

        return player;
    } catch (err) {
        logger.error('[fishHunterCache][updatePlayerGameState] playerId: %s, gameState: %s, err: ', playerId, gameState, err);
    }
}

// 刪除該在線玩家Cache
proto.delOnlinePlayer = function (playerId) {
    try {
        this.db.selectDB(DB_ONLINE_PLAYERS);
        let player = this.db.hget('onlinePlayers', playerId);
        if (!player) return false;

        return this.db.hdel('onlinePlayers', playerId);
    } catch (err) {
        logger.error('[fishHunterCache][delOnlinePlayer] playerId: %s, err: ', playerId, err);
    }
}


proto.setFishRTP = function (gameId, room, value) {
    this.db.selectDB(DB_FISH_RTP);

    return this.db.hset(gameId, room, value);
}
proto.getFishRTP = function (gameId, room) {
    try {
        this.db.selectDB(DB_FISH_RTP);

        if (!room) {
            room = 'global';
        }
        room = 'global';
        if (!this.db.exists(gameId)) {
            this.db.hset(gameId, room, null);
            return null;
        }
        return this.db.hget(gameId, room);
    } catch (err) {
        logger.error('[fishHunterCache][getFishRTP] gameId: %s, room: %s, err: ', gameId, room, err);
    }
}
proto.getFishRTPKeys = function () {
    this.db.selectDB(DB_FISH_RTP);

    return this.db.keys('*');
}


// 新增要 cancelFire 的子彈ID & cost
proto.addCancelBullets = function (key, bulletId, cost) {
    try {
        this.db.selectDB(DB_CANCEL_FIRE);
        return this.db.hset(key, bulletId, cost);
    } catch (err) {
        logger.error('[fishHunterCache][addCancelBullets] key: %s, bulletId: %s, err: ', key, bulletId, err);
    }
}

proto.getPlayerCancelBullets = function (key) {
    try {
        this.db.selectDB(DB_CANCEL_FIRE);
        return this.db.hvals(key);
    } catch (err) {
        logger.error('[fishHunterCache][getPlayerCancelBullets] key: %s, err: ', key, err);
    }
}
proto.getCancelFirePlayers = function () {
    try {
        this.db.selectDB(DB_CANCEL_FIRE);
        let all = this.db.keys('*');
        let playerDatas = [];
        for (let key of all) {
            if (this.db.hkeys(key).length > 0) playerDatas.push(key);
        }
        return playerDatas;
    } catch (err) {
        logger.error('[fishHunterCache][getCancelFirePlayers] err: ', err);
    }
}

proto.delCancelBullets = function (key, bid) {
    try {
        this.db.selectDB(DB_CANCEL_FIRE);

        if (!this.db.hexists(key, bid)) {
            return false;
        }

        return this.db.hdel(key, bid);
    } catch (err) {
        logger.error('[fishHunterCache][delCancelBullets] key: %s, bulletId: %s, err: ', key, bId, err);
    }
}

proto.getAllBazooka = function (playerId) {
    try {
        this.db.selectDB(DB_BAZOOKA);
        return this.db.hvals(playerId);
    } catch (err) {
        logger.error('[fishHunterCache][getAllBazooka] playerId: %s, err: ', playerId, err);
    }
}

proto.addBazookaAlive = function (playerId, cost, alive) {
    try {
        this.db.selectDB(DB_BAZOOKA);
        return this.db.hset(playerId, cost, {alive, actualAlive: alive});
    } catch (err) {
        logger.error('[fishHunterCache][addBazooka] playerId: %s, cost: %s, alive: %s, err: ', playerId, cost, alive, err);
    }
}

proto.getBazookaAlive = function (playerId, cost) {
    try {
        this.db.selectDB(DB_BAZOOKA);
        if (!cost) return null;
        return this.db.hget(playerId, cost);
    } catch (err) {
        logger.error('[fishHunterCache][getBazooka] playerId: %s, cost: %s, err: ', playerId, cost, err);
    }
}

proto.delBazookaAlive = function (playerId, cost) {
    try {
        this.db.selectDB(DB_BAZOOKA);
        let alive = this.db.get(playerId, cost);
        if (!alive) return false;

        if (!!cost)
            return this.db.hdel(playerId, cost);
        else
            return this.db.del(playerId);
    } catch (err) {
        logger.error('[fishHunterCache][DestroyBullet] playerId: %s, err: ', playerId, err);
    }
}


proto.delBazookaTreasure = function (playerId) {
    try {
        this.db.selectDB(DB_TREASURE);
        let allBazooka = this.db.hvals(playerId);

        for (let bulletId in allBazooka) {
            this.DestroyBullet(playerId, bulletId);
            this.delTreasure(playerId, bulletId);
        }
        return true;
    } catch (err) {
        logger.error('[fishHunterCache][delTreasure] playerId: %s, err: ', playerId, err);
    }
}

proto.addOneBulletHistory = function (bulletHistory) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let playerId = bulletHistory.playerId;
        return this.db.sadd(playerId, bulletHistory);
    } catch (err) {
        logger.error('[fishHunterCache][addOneBulletHistory] bulletHistory: %s, err: ', JSON.stringify(bulletHistory), err);
    }
}
proto.getOneBulletHistory = function (playerId, insertId) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let bullets = this.db.get(playerId);
        for (let i in bullets) {
            const one = bullets[i];
            if (!one) {
                continue;
            }
            if (one._id === insertId) {
                return one;
            }
        }
        return null;
    } catch (err) {
        logger.error('[fishHunterCache][getOneBulletHistory] playerId: %s, insertId: %s, err: ', playerId, insertId, err);
    }
}
proto.getOneBulletHistoryByBulletId = function (playerId, bulletId) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let bullets = this.db.get(playerId);
        for (let i in bullets) {
            const bullet = bullets[i];
            if (!bullet) {
                continue;
            }
            if (bullet.bulletId === bulletId) {
                return bullet;
            }
        }
        return null;
    } catch (err) {
        logger.error('[fishHunterCache][getOneBulletHistoryByBulletId] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
    }
}
proto.delOneBulletHistory = function (playerId, insertId) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let bullets = this.db.get(playerId);
        let target;
        for (let i in bullets) {
            const bullet = bullets[i];
            if (bullet._id === insertId) {
                target = bullet;
                break;
            }
        }

        if (target) {
            return this.db.sdel(playerId, target);
        } else {
            return false;
        }
    } catch (err) {
        logger.error('[fishHunterCache][delOneBulletHistory] playerId: %s, insertId: %s, err: ', playerId, insertId, err);
    }
}

proto.delAllBulletHistory = function (playerId, gameId) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let bullets = this.getAllBulletHistory(playerId, gameId);
        let count = 0;
        for (let i in bullets) {
            const one = bullets[i];
            if (!one) {
                continue;
            }
            //player.isSingleWallet == consts.walletType.singleBetAndWinDelay &&
            if ((one.endReason !== 'Flying' && one.endReason !== 'FireComplete' && one.endReason !== 'WeaponFireComplete')) {
                continue;
            }
            this.db.sdel(playerId, one);
            count++;

        }
        logger.info('playerId: %s, gameId: %s, 刪除 %s 筆cache中的BulletHistory data', playerId, gameId, count);
        return true;
    } catch (err) {
        logger.error('[fishHunterCache][delAllBulletHistory] playerId: %s, gameId: %s, err: ', player._id, gameId, err);
        return false;
    }
}

proto.delOneBulletHistoryByBulletId = function (playerId, bulletId) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let bullets = this.db.get(playerId);
        let bullet;

        for (let i in bullets) {
            const one = bullets[i];
            if (!one) {
                continue;
            }
            if (one.bulletId === bulletId) {
                bullet = one;
                break;
            }
        }

        if (bullet) {
            return this.db.sdel(playerId, bullet);
        } else
            return false;
    } catch (err) {
        logger.error('[fishHunterCache][delOneBulletHistoryByBulletId] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
    }
}
proto.getAllBulletHistory = function (playerId, gameId) {
    try {
        this.db.selectDB(DB_BULLET_HISTORY);
        let bullets = this.db.get(playerId);
        if (bullets)
            return bullets.filter((bulletHistory) => {
                return (!!bulletHistory && bulletHistory.gameId == gameId)
            });
        else
            return null;
    } catch (err) {
        logger.error('[fishHunterCache][getAllBulletHistory] playerId: %s, gameId: %s, err: ', playerId, gameId, err);
        return null;
    }
}

proto.getKey = function (..._val) {
    try {
        let res;
        _val = _val.shift();
        res = _val.shift();
        while (_val.length > 0) {
            res = res + '-' + _val.shift();
        }
        return res;
    } catch (err) {
        logger.error('[fishHunterCache][getKey][catch] err: ', err);
    }
}
proto.setApiAuthInfo = function (playerId, gameId, apiMethod) {
    try {
        this.db.selectDB(DB_API_AUTH);
        let key = this.getKey([playerId, gameId]);
        return this.db.hset(key, apiMethod, true);
    } catch (err) {
        logger.error('[fishHunterCache][setApiAuthInfo][catch] playerId: %s, err: ', playerId, err);
    }
}
proto.getApiAuthInfo = function (playerId, gameId, apiMethod) {
    try {
        this.db.selectDB(DB_API_AUTH);
        let key = this.getKey([playerId, gameId]);
        return this.db.hget(key, apiMethod);
    } catch (err) {
        logger.error('[fishHunterCache][getApiAuthInfo][catch] playerId: %s, err: ', playerId, err);
        // newly add throw
        throw err;
    }
}
proto.delApiAuthInfo = function (playerId, gameId, apiMethod) {
    try {
        this.db.selectDB(DB_API_AUTH);
        let key = this.getKey([playerId, gameId]);
        return this.db.hdel(key, apiMethod);
    } catch (err) {
        logger.error('[fishHunterCache][delApiAuthInfo][catch] playerId: %s, err: ', playerId, err);
    }
}
proto.delAllApiAuthInfo = function (playerId, gameId) {
    try {
        this.db.selectDB(DB_API_AUTH);
        let key = this.getKey([playerId, gameId]);
        return this.db.del(key);
    } catch (err) {
        logger.error('[fishHunterCache][delApiAuthInfo][catch] playerId: %s, err: ', playerId, err);
    }
}

proto.checkRequestDef = function (playerId, gameId, requestDefData) {
    return {code: C.OK};
    /*
    try {
      let dt = Date.now();
      // 取逞罰紀錄
      let checkLock = this.getOneRequestLock(playerId, gameId, requestDefData);
      // 檢查是否已被逞罰
      if (checkLock) {
        if (dt - checkLock.lockTime > requestDefData.lockTime * 1000) {
          // 超過逞罰時間，就刪除
          checkLock = this.delOneRequestLock(playerId, gameId, requestDefData);
        }
        // 事件請求太多次的逞罰
        if (checkLock)  {
          return {code: C.REQUEST_TOO_SOON};
        }
      }
  
      // 計算請求次數
      let oneRequestDef = this.getOneRequestDef(playerId, gameId, requestDefData);
      if (!oneRequestDef) {
        // 不存在時新增一筆
        oneRequestDef = this.addOneRequestDef(playerId, gameId, requestDefData, dt);
      } else {
        // 存在就檢查時間，超過checkTime就重置
        if (dt - oneRequestDef.checkTime > oneRequestDef.TTL * 1000) {
          oneRequestDef.count = 0;
          oneRequestDef.checkTime = dt;
        }
      }
  
      // 增加次數
      oneRequestDef.count++;
  
      // 請求超過次數上限
      if (oneRequestDef.count >= requestDefData.requestCount) {
        // 清掉原本那筆
        oneRequestDef = this.delOneRequestDef(playerId, gameId, requestDefData);
  
        // 設定逞罰紀錄
        let oneRequestLock = this.addOneRequestLock(playerId, gameId, requestDefData, dt);
  
        return {code: C.REQUEST_TOO_SOON};
      }
  
      return {code: C.OK};
    } catch (err) {
      logger.error('[fishHunterCache][checkRequestDef][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
      return {code: C.REQUEST_TOO_SOON};
    }
     */
}

proto.addOneRequestDef = function (playerId, gameId, requestDefData, dt) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId, requestDefData.redisKey]);
        if (this.db.hexists(key, requestDefData.redisKey)) {
            return false;
        }
        let data = _.cloneDeep(requestDefData);
        data.count = 0;
        data.checkTime = dt;
        let res = this.db.hset(key, requestDefData.redisKey, data);

        // 若有計時器就先清掉
        if (this.timerIds[key])
            clearTimeout(this.timerIds[key]);

        // 定時清掉
        this.timerIds[key] = setTimeout(() => {
            this.delOneRequestDef(playerId, gameId, requestDefData);
        }, requestDefData.TTL * 1000);

        return res ? this.db.hget(key, requestDefData.redisKey) : res;
    } catch (err) {
        logger.error('[fishHunterCache][addOneRequestDef][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
    }
}
proto.getOneRequestDef = function (playerId, gameId, requestDefData) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId, requestDefData.redisKey]);
        return this.db.hget(key, requestDefData.redisKey);
    } catch (err) {
        logger.error('[fishHunterCache][getOneRequestDef][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
    }
}
proto.delOneRequestDef = function (playerId, gameId, requestDefData) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId, requestDefData.redisKey]);
        if (!this.db.hexists(key, requestDefData.redisKey)) {
            return false;
        }

        // 若有計時器就先清掉
        if (this.timerIds[key])
            delete this.timerIds[key];

        return this.db.hdel(key, requestDefData.redisKey);
    } catch (err) {
        logger.error('[fishHunterCache][delOneRequestDef][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
    }
}
proto.addOneRequestLock = function (playerId, gameId, requestDefData, dt) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId, requestDefData.lockKey]);
        if (this.db.hexists(key, requestDefData.lockKey)) {
            return false;
        }
        let data = _.cloneDeep(requestDefData);
        data.count = 0;
        data.lockTime = dt + requestDefData.lockTime * 1000;
        let res = this.db.hset(key, requestDefData.lockKey, data);

        // 若有計時器就先清掉
        if (this.timerIds[key])
            clearTimeout(this.timerIds[key]);

        // 定時清掉
        this.timerIds[key] = setTimeout(() => {
            this.delOneRequestLock(playerId, gameId, requestDefData);
        }, data.lockTime);

        return res ? this.db.hget(key, requestDefData.lockKey) : res;
    } catch (err) {
        logger.error('[fishHunterCache][addOneRequestLock][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
    }
}
proto.getOneRequestLock = function (playerId, gameId, requestDefData) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId, requestDefData.lockKey]);
        return this.db.hget(key, requestDefData.lockKey);
    } catch (err) {
        logger.error('[fishHunterCache][getOneRequestLock][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
    }
}
proto.delOneRequestLock = function (playerId, gameId, requestDefData) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId, requestDefData.lockKey]);
        if (!this.db.hexists(key, requestDefData.lockKey)) {
            return false;
        }

        // 若有計時器就先清掉
        if (this.timerIds[key])
            delete this.timerIds[key];

        let res = this.db.hdel(key, requestDefData.lockKey);
        return res ? this.db.hget(key, requestDefData.lockKey) : res;
    } catch (err) {
        logger.error('[fishHunterCache][delOneRequestLock][catch] playerId: %s, gameId: %s, requestDefData: %s, err: ', playerId, gameId, requestDefData, err);
    }
}
proto.clearAllRequestData = function (playerId, gameId) {
    try {
        this.db.selectDB(DB_REQUEST_DEF);
        let key = this.getKey([playerId, gameId]);
        return this.db.del(key);
    } catch (err) {
        logger.error('[fishHunterCache][clearAllRequestData][catch] playerId: %s, gameId: %s, err: ', playerId, gameId, requestDefData, err);
    }
}

proto.setBetResult = function (playerId, bulletId, succ) {
    this.db.selectDB(DB_WALLET_BET_RESULT);

    this.db.hset(playerId, bulletId, succ);
}

proto.getBetResult = function (playerId, bulletId) {
    this.db.selectDB(DB_WALLET_BET_RESULT);

    if (!this.db.hexists(playerId, bulletId)) {
        return false;
    }

    return this.db.hget(playerId, bulletId);
}

proto.hasBetResult = function (playerId, bulletId) {
    this.db.selectDB(DB_WALLET_BET_RESULT);

    if (!this.db.hexists(playerId, bulletId)) {
        return false;
    }

    return true;
}

proto.delBetResult = function (playerId, bulletId) {
    this.db.selectDB(DB_WALLET_BET_RESULT);

    this.db.hdel(playerId, bulletId);
}

proto.clearBetResult = function (playerId) {
    this.db.selectDB(DB_WALLET_BET_RESULT);

    return this.db.del(playerId);
}
