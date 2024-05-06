let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('fire', __filename);
let utils = require('../utils/utils');
let consts = require('../../share/consts');
let util = require('util');

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

const BulletFlying = 'Flying';             // 子彈 飛行中 未扣款
const FireComplete = 'FireComplete';       // 子彈 飛行中 已扣款
const FireCollider = 'FireCollider';       // 子彈 已碰撞 未派彩
const CollidReward = 'CollidReward';       // 子彈 已碰撞 已派彩
const WeaponFireComplete = 'WeaponFireComplete'; // 特殊武器 發射完 飛行中
const WeaponReward = 'WeaponReward';       // 特殊武器 已碰撞 已派彩
const LeaveTableRefund = 'LeaveTableRefund';   // 離桌退款
const CancelFire = 'CancelFire';         // 取消發射

proto.detectState = function (bullet, data) {
    try {
        switch (bullet) { // 舊的狀態
            case BulletFlying://新的值是下一個狀態
            case WeaponFireComplete:
                switch (data) {
                    case FireComplete:
                    case FireCollider:
                    case CollidReward:
                    case WeaponReward:
                        bullet = data;
                        break;
                }
                break;
            case FireComplete:
                switch (data) {
                    case FireCollider:
                    case CollidReward:
                        bullet = data;
                        break;
                }
                break;
            case FireCollider:
                if (data == CollidReward) bullet = data;
                break;
        }
        return bullet;
    } catch (err) {
        logger.error('[bullet][detectState] bullet: %s, err: ', JSON.stringify(bullet), err);
    }
}

//新增飛行中的子彈(一般子彈)=>待處理扣款
proto.AddFlyingBullet = async function (bulletData) {
    try {
        let opts = bulletData;
        opts.endReason = BulletFlying; // 子彈 飛行中 未扣款
        opts._id = utils.shortid();

        this.app.controllers.fishHunterCache.addOneBulletHistory(opts);
        return opts._id;
    } catch (err) {
        logger.error('[bullet][AddFlyingBullet] bulletData: %s, err: ', JSON.stringify(bulletData), err);
    }
}

//飛行中的子彈=>扣款完成=>更新子彈歷史狀態設定完成
proto.setFireComplete = cort(function* (insertId, bId, beforeBalance, afterBalance, playerId) {
    try {
        let data = {
            endReason: FireComplete, // 子彈 飛行中 已扣款
            // afterFireBalance: afterBalance,
            // beforeFireBalance: beforeBalance,
            // endFireTime: utils.timeConvert(Date.now()), // 轉美東時間
        }
        let self = this;

        let bullet;
        bullet = self.app.controllers.fishHunterCache.getOneBulletHistory(playerId, insertId);

        if (!bullet) {
            logger.warn('找不到bullet to set FireComplete, playerId: %s, bId: %s, insertId: %s', playerId, bId, insertId);
            return false;
        }
        for (let i in data) {
            switch (i) {
                case 'endReason':
                    bullet[i] = proto.detectState(bullet[i], data[i]);
                    break;
                default:
                    bullet[i] = data[i];
                    break;
            }
        }
    } catch (err) {
        logger.error('[bullet][setFireComplete] _id: %s, err: ', insertId, err);
    }
})

//飛行中的子彈=>特殊武器
proto.AddFlyingWeaponBullet = cort(function* (bulletData, wId) {
    try {
        let self = this;

        let opts = bulletData;
        opts.endReason = WeaponFireComplete;               // 特殊武器 發射完 飛行中
        // opts.endFireTime = utils.timeConvert(Date.now()),
        opts['getInfo'] = {};                              // getInfo初始
        opts['getInfo']['originalCost'] = bulletData.cost; // 原始押注分數
        opts.cost = 0;                                     // 特殊武器的押注cost改為0
        opts.wId = wId;

        if (bulletData.shootType == consts.FishType.BAZOOKA) {
            self.app.controllers.fishHunterCache.addOneBulletHistory(opts);
        }

        return opts._id;
    } catch (err) {
        logger.error('[bullet][AddFlyingWeaponBullet] bulletData: %s, err: ', JSON.stringify(bulletData), err);
    }
});

// 子彈碰撞子單處理
proto.handleBulletCollider = cort(function* (player, bulletData, isWeapon) {
    try {
        let self = this;
        let bulletHistory = null;
        let playerId = player._id;
        let bulletId = bulletData.bulletId;
        bulletData.endReason = bulletData.gain > 0 ? (!isWeapon ? CollidReward : WeaponReward) : FireCollider; // 結束原因

        if (!isWeapon || bulletData.shootType === consts.FishType.BAZOOKA) {
            // 一般子彈 或 Bazooka
            // 取出 bullet cache
            bulletHistory = self.app.controllers.fishHunterCache.getOneBulletHistoryByBulletId(playerId, bulletId);
            if (!bulletHistory) {
                logger.warn(`[bullet][handleBulletCollider] playerId: ${playerId}, not find bullet cache. bulletData:`, bulletData);
                bulletHistory = bulletData;
                // 補上缺少的資料
                bulletHistory.playerId = playerId;
                bulletHistory.areaId = player.areaId;
                bulletHistory.alive = typeof bulletData.alive == 'undefined' ? 1 : bulletData.alive;
                bulletHistory.shootType = typeof bulletData.shootType == 'undefined' ? 'normal' : bulletData.shootType;
                bulletHistory._id = bulletData.sbuRepair._id == '' ? utils.shortid() : bulletData.sbuRepair._id;
                bulletHistory.cost = typeof bulletData.cost == 'undefined' ? bulletData.sbuRepair.cost : bulletData.cost;
                bulletHistory.denom = bulletData.sbuRepair.denom;

                // 新增一筆 bullet cache // 讓子單正常存入
                self.app.controllers.fishHunterCache.addOneBulletHistory(bulletHistory);
            } else {
                // 更新子單資料
                for (let i in bulletData) {
                    if (i == '_id') continue; // 子單id不得修改
                    bulletHistory[i] = bulletData[i];
                }
            }
        } else {
            // 鑽頭炮 & 雷射炮 & 炸彈蟹 & 連環炸彈蟹
            bulletHistory = _.cloneDeep(bulletData);
            // 新增一筆 bullet cache
            self.app.controllers.fishHunterCache.addOneBulletHistory(bulletHistory);
        }
        // 存memdb
        yield self.saveOneBulletToMemDB(player, bulletHistory._id, bulletHistory.wId);
        return;
    } catch (err) {
        logger.error(`[bullet][handleBulletCollider] playerId: ${player._id} err:`, err);
    }
});

//離場,如果還有飛行中的一般子彈 進行退款所寫的退款紀錄
proto.AddRefund = cort(function* (data) {
    try {
        // 試玩不寫帳
        if (data.demo == consts.demoType.demo) return;
        let obj = {
            _id: utils.shortid(),
            createTime: utils.timeConvert(Date.now()),
            finishTime: utils.timeConvert(Date.now(), true), // 寫入退款完成時間
            denom: data.denom,
            cost: utils.number.oneThousand(data.bet, consts.Math.MULTIPLY),
            areaId: data.areaId,
            playerId: data.playerId,
            gain: utils.number.oneThousand(data.refund, consts.Math.MULTIPLY),
            bulletId: data.bulletId,
            returnInfo: data.returnInfo,
            endReason: LeaveTableRefund, // 離桌退款
            shootType: 'return',
            wId: data.wId,
            idx: data.idx
        }
        let bullet = new this.app.models.FishHunterBulletsHistory(obj);
        let bulletHistory = _.cloneDeep(bullet);
        bulletHistory = yield this.handlerBillLog(bulletHistory, true);
        logger.info('[子單][bullet]5.[AddRefund] bulletHistory: ', bulletHistory);
        yield bullet.saveAsync();
        return;
    } catch (err) {
        logger.error('[bullet][AddRefund] refundData: %s, err: ', JSON.stringify(data), err);
    }
});

// 找子單紀錄並刪除
proto.delCancelFire = cort(function* (playerId, bulletId) {
    try {
        if (!this.app.controllers.fishHunterCache.delOneBulletHistoryByBulletId(playerId, bulletId)) {
            // 當玩家離線時會刪除子彈快取導致找不到，改印warn
            logger.warn('[bullet][delCancelFire] delete subRecord fail playerId: %s, bulletId: %s ', playerId, bulletId);
            return false;
        }
        logger.debug('[bullet][delCancelFire] delete subRecord success playerId: %s, bulletId: %s ', playerId, bulletId);

        return true;
    } catch (err) {
        logger.error('[bullet][delCancelFire] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
        return false;
    }
});

proto.incrBazooka = function (playerId, gameId, tableLevel, cost, alive) {
    try {
        let self = this;
        let cache = self.app.controllers.fishHunterCache;
        let serverId = self.app.getServerId();

        let all = cache.getAllBazooka(playerId); // 取所有 cost 剩餘子彈
        // 第一次獲得: null // 刪除過後: {} // 有值: { '1': { alive: 39 }, '2': { alive: 20 } }
        logger.info(`[bullet][incrBazooka] 1. playerId: ${playerId}, serverId:${serverId}, cost: ${cost}, alive: ${alive}, get bazooka alive by all: `, all);

        let originalAlive = null;
        if (!all || Object.keys(all).length === 0) {
            let res = cache.addBazookaAlive(playerId, cost, alive);
            logger.info(`[bullet][incrBazooka] 2-1. playerId: ${playerId}, serverId:${serverId}, add bazooka alive cost: ${cost}, alive: ${alive}, res: `, res);
        } else {
            let totalAlive = 0;
            Object.keys(all).forEach((cost) => {
                totalAlive += all[cost].alive;
            });

            originalAlive = totalAlive; // 原始剩餘子彈數
            const config = self.app.controllers.fishHunterConfig.getGameConfig(gameId, tableLevel);
            let maxFreeBullets = config.cannon.maxFreeBullets;
            totalAlive += alive; // 總數量 加上獲得子彈數
            logger.info(`[bullet][incrBazooka] 2-2. playerId: ${playerId}, serverId:${serverId}, cost: ${cost}, alive: ${alive}, maxFreeBullets: ${maxFreeBullets}, totalAlive: `, totalAlive);

            if (totalAlive > maxFreeBullets) {
                let amoumt = totalAlive - maxFreeBullets; // 1048 - 999 = 49
                alive -= amoumt; // 50 - 49 = 1 實際獲得子彈數
            }

            let bazooka = cache.getBazookaAlive(playerId, cost);
            logger.info(`[bullet][incrBazooka] 2-2. playerId: ${playerId}, serverId:${serverId}, realAlive: ${alive}, get bazooka alive by cost(${cost}): `, bazooka);
            if (!bazooka) {
                let res = cache.addBazookaAlive(playerId, cost, alive);
                logger.info(`[bullet][incrBazooka] 2-2-1. playerId: ${playerId}, serverId:${serverId}, add bazooka cost: ${cost}, alive: ${alive}, res: `, res);
            } else {
                bazooka.alive += alive; // 該 cost 加上獲得子彈數
                bazooka.actualAlive += alive;
                logger.info(`[bullet][incrBazooka] 2-2-2. playerId: ${playerId}, serverId:${serverId}, add bazooka cost: ${cost}, alive: ${alive}, bazooka: `, bazooka);
            }
            logger.info(`[bullet][incrBazooka] 2-2 done. playerId: ${playerId}, serverId:${serverId}, add bazooka cost: ${cost}, alive: ${alive}, bazooka: `, bazooka);
        }
        return {alive, originalAlive};
    } catch (err) {
        logger.error('[bullet][incrBazooka] playerId: %s, gameId: %s, tableLevel: %s, cost: %s, alive: %s, err: ', playerId, gameId, tableLevel, cost, alive, err);
    }
}

proto.setBazookaAlive = function (playerId, gameId, cost, alive) {
    try {
        this.app.controllers.fishHunterCache.addBazookaAlive(playerId, cost, alive);
        return {alive, actualAlive: alive};
    } catch (err) {
        logger.error('[bullet][incrBazooka] playerId: %s, gameId: %s, cost: %s, alive: %s, err: ', playerId, gameId, cost, alive, err);
    }
}

proto.saveOneBulletToMemDB = cort(function* (player, insertId, wId) {
    let playerId = player._id;
    let gameId = player.gameId;
    let demo = player.demo;
    try {
        let bulletData = this.app.controllers.fishHunterCache.getOneBulletHistory(playerId, insertId);
        bulletData.wId = wId;

        //如果是免费子弹
        if (bulletData.hasOwnProperty("getBulletId")) {
            let cache = this.app.controllers.fishHunterCache;

            let billSucc = cache.getBetResult(playerId, bulletData.getBulletId);
            let hasResult = cache.hasBetResult(playerId, bulletData.getBulletId);

            logger.debug(`
        saveOneBulletToMemDB billSucc:${billSucc} - hasResult:${hasResult}
        --wId:${bulletData.wId} - idx:${bulletData.idx}
        --getBulletId:${bulletData.getBulletId}
      `);

            //如果还没有下注成功
            if (!billSucc) {

                //没结果，则暂缓保存
                if (!hasResult) {
                    bulletData.savePend = true;
                    if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) {
                        // 後扣型錢包: redis 存入獲得該武器的一般子彈可能扣款成功的 subId // 用獲得該免費武器的來源 wId
                        yield this.app.controllers.redisCache.addSubIdFromAPIfail(player.gameServerId, insertId, bulletData.sourceWid, bulletData.wId);
                    }
                } else {
                    //结果扣款失败， 则清理记录
                    this.app.controllers.fishHunterCache.delOneBulletHistory(playerId, insertId);
                    this.cancelBulletFreeGain(playerId, gameId, bulletData.gain, [{
                        wId: bulletData.wId,
                        idx: bulletData.idx
                    }]);
                    // 後扣型錢包: 只有扣款失敗不存子單
                    if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) return;
                }
                // 其他錢包: 照原邏輯 return
                if (player.isSingleWallet !== consts.walletType.singleBetAndWinDelay) return;
            }
        }

        if (bulletData.cost > 0) bulletData.cost = utils.number.oneThousand(bulletData.cost, consts.Math.MULTIPLY);
        if (bulletData.gain > 0) bulletData.gain = utils.number.oneThousand(bulletData.gain, consts.Math.MULTIPLY);
        bulletData.finishTime = utils.timeConvert(Date.now(), true);

        let bulletHistory = new this.app.models.FishHunterBulletsHistory(bulletData);
        bulletHistory = yield this.handlerBillLog(bulletHistory, true);

        if (this.app.controllers.fishHunterCache.delOneBulletHistory(playerId, insertId)) {
            // 試玩不寫帳
            if (demo == consts.demoType.demo) return;
            yield bulletHistory.saveAsync();
            bulletHistory = yield this.handlerBillLog(bulletHistory, false);
            logger.info('[子單][bullet][saveOneBulletToMemDB] bulletHistory: ', bulletHistory);
        } else {
            // 試玩不印log
            if (demo == consts.demoType.demo) return;

            // 後扣型錢包不印 error: 因為有可能一般子彈的扣款已經成功，並且寫入子單以及刪除子彈 cache，所以不需印 error
            if (player.isSingleWallet == consts.walletType.singleBetAndWinDelay) {
                logger.warn('[子單][bullet][saveOneBulletToMemDB] bulletHistory: del error  ', bulletHistory);
                return;
            }
            logger.error('[bullet][saveOneBulletToMemDB] playerId: %s, delOneBulletHistory failed. bulletHistory: ', playerId, bulletHistory);
        }
    } catch (err) {
        logger.error('[bullet][saveOneBulletToMemDB] playerId: %s, insertId: %s, wId: %s err: ', playerId, insertId, wId, err);
    }
});

// proto.saveOneBulletToMemDBByBulletId = cort(function*(playerId, bulletId, wId, gameId, demo) {
//   try {
//     let bulletData = this.app.controllers.fishHunterCache.getOneBulletHistoryByBulletId(playerId, bulletId);
//     if (!bulletData) {
//       // logger.error('[bullet][saveOneBulletToMemDBByBulletId] playerId: %s, bulletId: %s, 子單紀錄已被刪除 bulletHistory: ', playerId, bulletId, bulletData);
//       return;
//     }
//     bulletData.wId = wId;
//     let insertId = bulletData._id;

//     //如果是免费子弹
//     if (bulletData.hasOwnProperty("getBulletId")) {
//       let cache = this.app.controllers.fishHunterCache;

//       let billSucc = cache.getBetResult(playerId, bulletData.getBulletId);
//       let hasResult = cache.hasBetResult(playerId, bulletData.getBulletId);

//       logger.debug(`
//         saveOneBulletToMemDBByBulletId billSucc:${billSucc} - hasResult:${hasResult}
//         --wId:${bulletData.wId} - idx:${bulletData.idx}
//         --getBulletId:${bulletData.getBulletId}
//       `);

//       //如果还没有下注成功
//       if(!billSucc) {

//         //没结果，则暂缓保存
//         if(!hasResult) {
//           bulletData.savePend = true;
//         }
//         else {
//           //结果失败， 则清理记录
//           this.app.controllers.fishHunterCache.delOneBulletHistory(playerId, insertId);
//           this.cancelBulletFreeGain(playerId, gameId, bulletData.gain, [{wId:bulletData.wId, idx:bulletData.idx}]);
//         }

//         return;
//       }
//     }

//     if (bulletData.cost > 0) bulletData.cost = utils.number.oneThousand(bulletData.cost, consts.Math.MULTIPLY);
//     if (bulletData.gain > 0) bulletData.gain = utils.number.oneThousand(bulletData.gain, consts.Math.MULTIPLY);
//     bulletData.finishTime = utils.timeConvert(Date.now(), true);

//     let bulletHistory = new this.app.models.FishHunterBulletsHistory(bulletData);
//     // 字串化，方便 log 看
//     if (!!bulletHistory.getInfo && Object.keys(bulletHistory.getInfo).length > 0 && Object.keys(bulletHistory.getInfo).indexOf('treasure') > -1) {
//       bulletHistory.getInfo.treasure.odds = _.toString(bulletHistory.getInfo.treasure.odds);
//     }

//     if (this.app.controllers.fishHunterCache.delOneBulletHistory(playerId, insertId)) {
//       // 試玩不寫帳
//       if (demo == consts.demoType.demo) return;
//       logger.info('[子單][bullet][saveOneBulletToMemDBByBulletId] bulletHistory: ', bulletHistory);
//       // 存子單
//       yield bulletHistory.saveAsync();
//     } else {
//       logger.error('[子單][bullet][saveOneBulletToMemDBByBulletId] bulletHistory del error ', bulletHistory);
//       throw 'delOneBulletHistory failed';
//     }
//   } catch (err) {
//     logger.error('[bullet][saveOneBulletToMemDBByBulletId] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
//   }
// });

proto.delBulletHistory = cort(function* (playerId, bulletId) {
    try {
        let bullet = this.app.controllers.fishHunterCache.getOneBulletHistoryByBulletId(playerId, bulletId);
        if (!bullet) {
            logger.error('[bullet][delBulletHistory] not find subRecord playerId: %s, bulletId: %s ', playerId, bulletId);
            return false;
        }
        let insertId = bullet._id;
        if (this.app.controllers.fishHunterCache.delOneBulletHistory(playerId, insertId)) {
            return true;
        } else
            throw 'delBulletHistory failed';
    } catch (err) {
        logger.error('[bullet][delBulletHistory] playerId: %s, bulletId: %s, err: ', playerId, bulletId, err);
    }
});

proto.getInitBullets = function (playerId, gameId) {
    try {
        let bullets = this.app.controllers.fishHunterCache.bullets(playerId, false);
        return bullets.filter((value) => {
            return value.shootType !== consts.FishType.BAZOOKA
        });
    } catch (err) {
        logger.error('[bullet][getInitBullets] playerId: %s, gameId: %s, err: ', playerId, gameId, err);
    }
}

proto.normalBulletBetFail = function (playerId, gameId, id, wagerId, gameServerId, bulletId, getInfo) {
    logger.debug(`playerId:${playerId}-gameId:${gameId}
  --id:${id}-bulletId:${bulletId}-getInfo:${util.inspect(getInfo, false, 10)}
  bullet.normalBulletBetFail`)
    let self = this;
    let cache = self.app.controllers.fishHunterCache;

    if (!!getInfo && getInfo.hasOwnProperty("weapon")) {
        // 有獲得免費子彈，立失敗flag
        cache.setBetResult(playerId, bulletId, false);

        logger.debug(`playerId:${playerId}-gameId:${gameId}
      --id:${id}-bulletId:${bulletId}-getInfo:${util.inspect(getInfo, false, 10)}
      --hasBetResult:${cache.hasBetResult(playerId, bulletId)}
      bullet.normalBulletBetFail`)
    }

    // 刪除自己的子彈 cache or memdb
    let bulletCache = cache.getOneBulletHistoryByBulletId(playerId, bulletId);
    if (!!bulletCache) {
        // cache 還存在就刪 cache
        id = id || bulletCache._id;

        cache.delOneBulletHistory(playerId, id);
        // 正常的失敗 清除獲得的
        self.app.controllers.redisCache.delWidFromAPIfail(gameServerId, wagerId);
    } else {
        if (!id) {
            logger.error(`playerId:${playerId}-gameId:${gameId}
      --id:${id}-bulletId:${bulletId}-getInfo:${util.inspect(getInfo, false, 10)}
      bullet.normalBulletBetFail`);
        } else {
            // cache 不存在，刪 memdb
            let bulletHistoryDao = self.app.controllers.daoMgr.getBulletHistoryDao();
            bulletHistoryDao.removeByIdAsync(id);
            self.app.controllers.redisCache.delWidFromAPIfail(gameServerId, wagerId);
        }
    }

    // 取得遊戲中所有的子彈 cache
    let bullets = cache.getAllBulletHistory(playerId, gameId);
    let freeGain = 0;
    let delBullets = [];
    let bills = [];
    for (let i in bullets) {
        // 取出此顆子彈獲得的免費子彈 cache
        if (bullets[i] && bullets[i].getBulletId == bulletId && bullets[i].savePend) {
            // 計算免費子彈獲得的贏分
            freeGain = utils.number.add(freeGain, bullets[i].gain);
            // 搜集要刪除的此顆子彈獲得的免費子彈 cache
            delBullets.push(bullets[i]._id);
            // 搜集要刪除的 memeWallet 帳單
            bills.push({wId: bullets[i].wId, idx: bullets[i].idx});
        }
    }

    logger.debug(`playerId:${playerId}-gameId:${gameId}
  --id:${id}-bulletId:${bulletId}-getInfo:${util.inspect(getInfo, false, 10)}
  --bills:${util.inspect(bills, false, 10)}
  bullet.normalBulletBetFail`);

    delBullets.forEach(v => {
        // 刪除此顆子彈獲得的免費子彈 cache
        cache.delOneBulletHistory(playerId, v);
    })

    return {freeGain, bills};
}

proto.normalBulletBetSucc = function (playerId, gameId, id, wagerId, gameServerId, bulletId, getInfo) {
    logger.debug(`playerId:${playerId}-gameId:${gameId}
  --id:${id}-bulletId:${bulletId}-getInfo:${util.inspect(getInfo, false, 10)}
  bullet.normalBulletBetSucc`)
    let self = this;
    let cache = self.app.controllers.fishHunterCache;
    let bulletHistoryDao = self.app.controllers.daoMgr.getBulletHistoryDao();

    if (!!getInfo && getInfo.hasOwnProperty("weapon")) {
        cache.setBetResult(playerId, bulletId, true);
        self.app.controllers.redisCache.delWidFromAPIfail(gameServerId, wagerId);

        let bullets = cache.getAllBulletHistory(playerId, gameId);
        let delBullets = [];
        for (let i in bullets) {
            if (bullets[i] && bullets[i].getBulletId == bulletId && bullets[i].savePend) {
                if (bullets[i].cost > 0) bullets[i].cost = utils.number.oneThousand(bullets[i].cost, consts.Math.MULTIPLY);
                if (bullets[i].gain > 0) bullets[i].gain = utils.number.oneThousand(bullets[i].gain, consts.Math.MULTIPLY);

                bulletHistoryDao.createAsync(bullets[i]);
                delBullets.push(bullets[i]._id);
            }
        }

        delBullets.forEach(v => {
            cache.delOneBulletHistory(playerId, v);
        })
    }
}

proto.cancelBulletFreeGain = function (playerId, gameId, gain, bills) {
    logger.debug(`playerId:${playerId}-gameId:${gameId}
  --gain:${gain}
  --bills:${util.inspect(bills, false, 10)}
  bullet.cancelBulletFreeGain`)

    let self = this;

    return P.resolve()
        .then(() => {
            return self.app.controllers.walletMgr.getWalletAsync(playerId, gameId);
        })
        .then((data) => {
            if (!!data) {
                let memWalletTemp = data;

                data.cancelFreeGain(gain, false, 1, bills, 'cancelBulletFreeGain', (err, data) => {
                    if (!!err) {
                        logger.error('bullet.cancelBulletFreeGain memWallet.cancelFreeGain error ', util.inspect({
                            playerId,
                            gameId,
                            gain
                        }, false, 10));
                    }

                    self.app.controllers.table.pushAsync(memWalletTemp.tableId, null, consts.route.client.game.UPDATE_BALANCE, {
                        pid: playerId,
                        balance: memWalletTemp.getRealTokens()
                    }, false);

                })
            } else {
                logger.error('bullet.cancelBulletFreeGain cancelFreeGain memWallet is null ', util.inspect({
                    playerId,
                    gameId,
                    gain
                }, false, 10));
            }
        })
        .catch(err => {
            logger.error('bullet.cancelBulletFreeGain cancelFreeGain memWallet is null ', util.inspect({
                playerId,
                gameId,
                gain
            }, false, 10), ' err ', err);
        })
}

// 新增 lucky draw 子單
proto.addLuckyDrawBulletHistory = async function (player, data) {
    let self = this;
    try {
        // 試玩不寫帳
        if (player.demo == consts.demoType.demo) return;
        let playerId = player._id;
        let bulletData = {
            cost: 0,
            gain: utils.number.oneThousand(data.gain, consts.Math.MULTIPLY),
            alive: -1,
            areaId: player.areaId,
            bulletId: data.bulletId,
            playerId: playerId,
            wId: data.wagerId,
            finishTime: utils.timeConvert(Date.now(), true),
            createTime: utils.timeConvert(Date.now()),
            shootType: data.shootType,
            endReason: 'CollidReward',
            hitFishes: 'Fish_100|flock',
            killFishes: true,
            denom: data.denom,
            getInfo: data.getInfo
        };

        let bulletHistory = new self.app.models.FishHunterBulletsHistory(bulletData);
        bulletHistory._id = utils.shortid();

        bulletHistory = await self.handlerBillLog(bulletHistory, true);
        logger.info('[子單][bullet][addLuckyDrawBulletHistory] bulletHistory: ', bulletHistory);
        await bulletHistory.saveAsync();
        return;
    } catch (err) {
        logger.error('[bullet][addLuckyDrawBulletHistory] playerId: %s, data: %s, err: ', player._id, JSON.stringify(data), err);
        return;
    }
}

// 處理帳單log字串化顯示  // 用於完整顯示 log 內容
proto.handlerBillLog = async function (bulletHistory, isSaveBefore) {
    try {
        // 存子單之前
        if (isSaveBefore) {
            // treasure
            if (!!bulletHistory.getInfo && Object.keys(bulletHistory.getInfo).length > 0 && Object.keys(bulletHistory.getInfo).indexOf('treasure') > -1) {
                let odds = bulletHistory.getInfo.treasure.odds[0];
                if (typeof odds == 'number' || typeof odds == 'string') {
                    // [ 50, 10, 0, 0, 0, 0, 80, 100 ] //  [ 0, 2, 2, 0, 3, 3, 2, 0, 1, 1, 1, 3 ] // [120,160,120,200,80,40,80,120,80,40] // [ '2x', 'Purple', 'Green', 'Purple' ]
                    bulletHistory.getInfo.treasure.odds = _.toString(bulletHistory.getInfo.treasure.odds);
                } else if (typeof odds == 'object') {
                    // [ [ 0, 8, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ] ] // [ { fid: 2, odd: 10 }, { fid: 0, odd: 10 }, { fid: 0, odd: 10 } ]
                    bulletHistory.getInfo.treasure.odds = JSON.stringify(bulletHistory.getInfo.treasure.odds);
                }
            }
            // returnInfo
            if (!!bulletHistory.returnInfo && Object.keys(bulletHistory.returnInfo).length > 0) {
                if (Object.keys(bulletHistory.returnInfo).indexOf('weapon') > -1) {
                    bulletHistory.returnInfo.weapon = JSON.stringify(bulletHistory.returnInfo.weapon);
                }
                if (Object.keys(bulletHistory.returnInfo).indexOf('normal') > -1) {
                    bulletHistory.returnInfo.normal = JSON.stringify(bulletHistory.returnInfo.normal);
                }
            }
        }
        // 存子單之後
        else {
            if (!bulletHistory.getInfo || Object.keys(bulletHistory.getInfo).length <= 0) return bulletHistory;

            let getInfoList = Object.keys(bulletHistory.getInfo);
            // extraBet
            if (getInfoList.indexOf('extraBet') > -1) {
                for (let i in bulletHistory.getInfo.extraBet) {
                    let item = bulletHistory.getInfo.extraBet[i];
                    if (Object.keys(item).indexOf('treasure') > -1) {
                        let odds = item.treasure.odds[0];
                        if (typeof odds == 'number' || typeof odds == 'string') {
                            // [ 50, 10, 0, 0, 0, 0, 80, 100 ] //  [ 0, 2, 2, 0, 3, 3, 2, 0, 1, 1, 1, 3 ] // [120,160,120,200,80,40,80,120,80,40] // [ '2x', 'Purple', 'Green', 'Purple' ]
                            bulletHistory.getInfo.extraBet[i].treasure.odds = _.toString(item.treasure.odds);
                        } else if (typeof odds == 'object') {
                            // [ [ 0, 8, 0 ], [ 0, 8, 0 ], [ 0, 8, 0 ] ] // [ { fid: 2, odd: 10 }, { fid: 0, odd: 10 }, { fid: 0, odd: 10 } ]
                            bulletHistory.getInfo.extraBet[i].treasure.odds = JSON.stringify(item.treasure.odds);
                        }
                    }
                    bulletHistory.getInfo.extraBet[i] = JSON.stringify(item);
                }
            }
            // 額外打到的魚
            if (getInfoList.indexOf(consts.FishState.FLASH_SHARK) > -1 ||
                getInfoList.indexOf(consts.FishState.FLASH) > -1 ||
                getInfoList.indexOf(consts.FishState.WAKEN) > -1 ||
                getInfoList.indexOf(consts.FishState.CHAIN) > -1 ||
                getInfoList.indexOf(consts.FishState.METEOR) > -1
            ) {
                for (let state of getInfoList) {
                    bulletHistory.getInfo[state].fishes = JSON.stringify(bulletHistory.getInfo[state].fishes);
                }
            }
        }

        return bulletHistory;
    } catch (err) {
        logger.error(`[bullet][handlerBillLog] playerId: ${bulletHistory.playerId}, bulletHistory: ${JSON.stringify(bulletHistory)}, err: `, err);
        return bulletHistory;
    }
}