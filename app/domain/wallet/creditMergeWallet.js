/**
 * Created by GOGA on 2019/7/13.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('wallet', __filename);
const uuid = require('uuid/v1');
const _ = require('lodash');
let util = require('util');
let utils = require('../../utils/utils');
let consts = require('../../../share/consts');
let C = require('../../../share/constant');
let MemoryWallet = require('./memoryWallet');
let BillChecker = require('./billChecker');

// const MAX_FROZEN_COST = 100;  // 可允許的最大未結帳cost
// let MAX_FROZEN_COST = 100;  // 可允許的最大未結帳cost

module.exports = creditMergeWallet = function (app, playerId, gameId, tableId, player, maxFrozenCost) {
    MemoryWallet.call(this, app, playerId, gameId, tableId);

    this.fetchAndUpdateAmount = true;

    this.areaId = player.areaId;
    this.roundID = player.roundID;
    this.billChecker = new BillChecker(app, playerId, gameId, player);
    this.buffers = {};
    this.timerId = null;
    this.beginIdx = 0;
    // MAX_FROZEN_COST = maxFrozenCost;
    this.maxFrozenCost = maxFrozenCost;

    this.isBonusGame = {};
    this.billType = consts.BillType.betWin;
}
util.inherits(creditMergeWallet, MemoryWallet);

let proto = creditMergeWallet.prototype;
let cort = P.coroutine;

proto.onInitAfter = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId} creditMergeWallet.onInitAfter `);

    return true;
}

proto.initAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.initAsync `);

    let self = this;
    let dao = self.app.controllers.daoMgr.getGameTokenDao();
    let tokens = null;
    if (!self.disable) {
        return P.reject('wallet already init');
    }

    return P.resolve()
        .then(() => {
            return dao.findOneAsync(self.playerId, self.gameId, true);
        })
        .then(async (data) => {
            tokens = data;
            if (!!tokens && self.amount <= tokens.amount && tokens.state == consts.WalletState.init) {
                self.amount = tokens.amount;
                self.ratio = tokens.ratio;
                let wagerId = tokens.wagerId;

                // 發生原因: 某台 backendServer 重啟，導致玩家被迫換其他台 backendServer，為預防玩家使用到與「舊 backendServerId」同一 wagerId，故這裡重新生成一個 wagerId。 by 2021.06.25 Mei
                if (self.billChecker.player.backendServerId !== self.app.getServerId()) {
                    let backendServer = self.app.getServerId();
                    self.billChecker.player.backendServerId = backendServer; // 更新 cache player.backendServerId
                    wagerId = utils.getWId(self.playerId, self.gameId); // 更新 wagerId
                    let editPlayer = await self.app.memdb.goose.transactionAsync(function () {
                        // 更新 memdb player.backendServerId
                        return self.app.controllers.fishHunterPlayer.internalUpdateAsync(self.playerId, {backendServerId: backendServer});
                    }, backendServer);
                    self.app.controllers.debug.info('info', 'creditMergeWallet.initAsync', {
                        playerId: self.playerId,
                        gameId: self.gameId,
                        oldBackendServer: self.billChecker.player.backendServerId,
                        oldWagerId: tokens.wagerId,
                        newBackendServer: backendServer,
                        newWagerId: wagerId,
                        editPlayerBackendServer: editPlayer.backendServerId,
                        reason: 'update player backendServerId.',
                    });
                }

                self.wagerId = wagerId;
                self.gain = 0;
                self.cost = 0;

                self.statGain = tokens.gain;
                self.statCost = tokens.cost;
                self.walletType = tokens.walletType;

                self.frozenCost = tokens.frozenCost;
                self.frozenGain = tokens.frozenGain;

                self.quota = tokens.quota;

                self.gameTypeId = tokens.gameTypeId;

                self.disable = false;

                return self.onInitAfter();
            } else {
                self.disable = true;

                return false;
            }
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId} creditMergeWallet.initAsync error `, err);

            return false;
        })
}

proto.bet = function (score) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --bet:${score},amount:${this.amount},gain:${this.gain},cost:${this.cost},ratio:${this.ratio}
  --frozenCost:${this.frozenCost},frozenCost:${this.frozenGain}
  --disable:${this.disable},stoped:${this.stoped}
  --maxFrozenCost:${this.maxFrozenCost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.bet `);

    let self = this;
    if (self.disable || self.stoped) {
        logger.warn('[creditMergeWallet][bet] playerId: %s, someone is true: disable: %s, stoped: %s', this.playerId, self.disable, self.stoped);
        return null;
    }

    let cash = utils.scoreToCash(score, self.ratio);
    if (self.amount + self.gain < self.cost + cash) {
        logger.warn(`[creditMergeWallet][bet] playerId: ${this.playerId}, quota: ${self.quota} player out gold. amount(${self.amount}) + gain(${self.gain}) < cost(${self.cost}) + cash(${cash}), score: ${score}, ratio: ${self.ratio}`);
        return null;
    }

    if (self.frozenCost >= self.maxFrozenCost) {
        logger.warn(`[creditMergeWallet][bet] playerId: ${this.playerId}, frozenCost(${self.frozenCost}) >= maxFrozenCostamount(${self.maxFrozenCostamount}), amount: ${self.amount}, quota: ${self.quota}, gain: ${self.gain}, cost: ${self.cost}, cash: ${cash}, score: ${score}, ratio: ${self.ratio}`);
        return null;
    }

    self.cost = utils.number.add(self.cost, cash);

    return {score, cash, ratio: self.ratio};
}

proto.betResult = function (winScore, ratio, betCash, otherData, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --winScore:${winScore},ratio:${ratio}, betCash:${betCash},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex}--otherData:${JSON.stringify(otherData)} creditMergeWallet.betResult `);
    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} creditMergeWallet.betResult error: stoped is true `, {
            winScore,
            ratio,
            betCash
        });

        return null;
    }

    if (otherData.isBonusGame) self.isBonusGame[this.wagerId] = otherData.isBonusGame;

    // 當特殊武器被當作一般子彈時，需重新扣款
    if (Math.abs(betCash) > 0 &&
        (otherData.shootType === consts.FishType.BAZOOKA ||
            otherData.shootType === consts.FishType.DRILL ||
            otherData.shootType === consts.FishType.LASER)
    ) {
        logger.info(`[creditMergeWallet][betResult] weapon be changed normal. playerId: ${this.playerId}, shootType: ${otherData.shootType}, betCash: ${betCash}`);
        let bet_res = self.bet(betCash);
        if (!bet_res) {
            logger.info(`[creditMergeWallet][betResult] bet fail. playerId: ${this.playerId}, shootType: ${otherData.shootType}, bet_res: ${bet_res}`);
            return null;
        }
    }

    let cash = utils.scoreToCash(winScore, ratio);
    self.gain = utils.number.add(self.gain, cash);

    self.frozenCost = utils.number.add(self.frozenCost, betCash);
    self.frozenGain = utils.number.add(self.frozenGain, cash);
    ++self.lastIndex;

    self._registerCallBack(self.wagerId, self.lastIndex, cb); // 創建 cache callback
    // self.billChecker.betAndWin(self.wagerId, self.lastIndex, betCash, cash,self._handleBillCallback.bind(this))
    if (!self.buffers[self.wagerId]) {
        self.buffers[self.wagerId] = []
    }
    self.buffers[self.wagerId].push({idx: self.lastIndex, bet: betCash, gain: cash, getWeapon: otherData.getWeapon});
    self._startCheckTimer();

    return {winScore, cash, ratio, lastIndex: self.lastIndex, wagerId: self.wagerId};
}

proto._handleBillCallback = function (err, data) {
    logger.info(`pId:${this.playerId}-gId:${this.gameId}
  --error:${!!err} --respone:${util.inspect(data, false, 10)}
  -lastIndex:${this.lastIndex}
  creditMergeWallet._handleBillCallback `);

    // call betAndWin 回來
    let self = this;
    let succ = false;
    const {wagerId, idx, code, beforeBalance, afterBalance} = data;

    logger.info(`[creditMergeWallet][_handleBillCallback] playerId: ${this.playerId}, wagerId: ${wagerId}
  buffers data: ${JSON.stringify(this.buffers)}`);

    let bills = self.buffers[wagerId];
    if (!!bills) {
        delete self.buffers[wagerId];
    } else {
        // 找不到帳務就不往下處理
        logger.warn(`no bills pId:${this.playerId}-gId:${this.gameId}
    --error:${!!err} --respone:${util.inspect(data, false, 10)},
    -idx:${this.lastIndex} creditMergeWallet._handleBillCallback `);
        return succ;
    }

    if (data.gain > 0) {
        self.gain = utils.number.sub(self.gain, data.gain);
        self.frozenGain = utils.number.sub(self.frozenGain, data.gain);
    }

    if (data.cost > 0) {
        self.cost = utils.number.sub(self.cost, data.cost);
        self.frozenCost = utils.number.sub(self.frozenCost, data.cost);
    }

    if (data.hasOwnProperty('amount')) {
        self.balanceUpdateTime = Date.now();

        self.amount = data.amount;
    }

    if (!err) {
        // call betAndWin 成功時的處理
        if (data.cost > 0) self.statCost = utils.number.add(self.statCost, data.cost); // 累計在tokens.cost(實際有扣款成功的)
        if (data.gain > 0) self.statGain = utils.number.add(self.statGain, data.gain); // 累計在tokens.gain(實際有扣款成功的)

        self._batchSave();
        self._saveAreaPlayerHistoryAsync(wagerId, idx, data.cost, data.gain, beforeBalance, afterBalance);

        // let keys = Object.keys(self.buffers);
        // if(keys.length > 0) {
        //   self._startCheckTimer();
        // }

        succ = true;
    } else {
        self.disable = true;
        self._disableCheck();

        succ = false;
        if (code == C.API_AUTH_TIME_OUT) {
            // self.statCost = utils.number.add(self.statCost, data.cost); // 累計在tokens.cost(實際有扣款成功的)
            // self.statGain = utils.number.add(self.statGain, data.gain); // 累計在tokens.gain(實際有扣款成功的)

            // API超時 或 retry，存 mongo 母單
            self._saveAreaPlayerHistoryAsync(wagerId, idx, data.cost, data.gain, beforeBalance, afterBalance);
            // 用來取出時分辨子單或是母單
            let forRedisWid = `main:${wagerId}`;
            // redis 存入可能扣款成功的 wid，給予排程檢查
            self.app.controllers.redisCache.addSubIdFromAPIfail(self.billChecker.player.gameServerId, forRedisWid, wagerId, '');

        }
    }

    if (!!bills) {
        let done = true;
        bills.forEach(v => {
            let tmp = {...data};
            tmp.idx = v.idx;
            tmp.cost = v.bet;
            tmp.gain = v.gain;

            // 用 cache callback 回去 betResult
            if (!self._invokeCallBack(wagerId, v.idx, err, tmp)) {
                done = false;

                self.waitFor(wagerId, v.idx);
            }
        })

        if (!done) {
            self.billChecker.setPaused(true);
        }
    }

    return succ;
}

proto._startCheckTimer = function () {
    let self = this;
    let checkTime = self.app.controllers.fishHunterConfig.getParamDefinConfig().updateSingleBetAndWinDelayTime * 1000;

    if (!!self.timerId) {
        return;
    }

    self.timerId = setTimeout(() => {
        self._timerHandle();
    }, checkTime);
}

proto._timerHandle = function () {
    let self = this;

    self.timerId = null;
    let arr = self.buffers[self.wagerId];
    if (!!arr && arr.length > 0) {
        //重新分配wagerId
        let oldWagerId = self.wagerId;
        self.wagerId = utils.getWId(self.playerId, self.gameId);
        self._commitBill(oldWagerId, false);
    } else {
        logger.warn(`[creditMergeWallet][_timerHandle] arr: ${arr}, playerId: ${self.playerId}, wagerId: ${self.wagerId}, buffers:`, self.buffers);
    }
}

proto._commitBill = function (wagerId, reorder) {
    let self = this;
    let arr = self.buffers[wagerId];
    let getWeapon = null;

    if (!!arr && arr.length > 0) {
        let bet = 0;
        let gain = 0;
        let bills = self.buffers[wagerId];

        bills.forEach(v => {
            bet = utils.number.add(bet, v.bet);
            gain = utils.number.add(gain, v.gain);
            if (!getWeapon) getWeapon = v.getWeapon;
        })

        logger.info(`pId:${self.playerId}-gId:${self.gameId}
     --wagerId:${wagerId}-count:${bills.length}
     --totalBet:${bet}-totalGain:${gain}
     --reorder:${reorder}
     --self.wagerId:${self.wagerId}
     -- data:${util.inspect(bills, false, 10)} creditMergeWallet._commitBill `);

        if (reorder) {
            self.billChecker.reorder(consts.BillType.betWin, {
                wId: wagerId,
                idx: bills.length,
                cost: bet,
                gain: gain
            }, false);
        } else {
            let wagersData = {
                amount: self.amount,
                denom: self.ratio,
                isBonusGame: self.isBonusGame[wagerId] || 0,
                gameTypeId: self.gameTypeId,
                getWeapon: getWeapon,
            };
            self.billChecker.betAndWin(wagerId, bills.length, bet, gain, false, wagersData, self._handleBillCallback.bind(this));
        }

        // if(bet > 0 || gain > 0) {
        //   self.billChecker.betAndWin(wagerId, bills.length, bet, gain, false, self._handleBillCallback.bind(this));
        // }
        // else {
        //   process.nextTick(() => {
        //     self._handleBillCallback(null,{
        //       wagerId,
        //       idx: bills.length,
        //       cost:0,
        //       gain:0,
        //       betSucc: true,
        //       winSucc: true
        //     });
        //   })
        // }
    } else {
        logger.warn(`[creditMergeWallet][_commitBill] arr: ${arr}, playerId: ${self.playerId}, wagerId: ${self.wagerId}, buffers:`, self.buffers);
    }
}

proto._recommit = function (wagerId) {
    let self = this;
    let bills = self.buffers[wagerId];
    let cost = 0;
    let gain = 0;

    bills.forEach(v => {
        cost = utils.number.add(cost, v.bet);
        gain = utils.number.add(gain, v.gain);
    })

    logger.debug(`pId:${self.playerId}-gId:${self.gameId}
   --wagerId:${wagerId}-count:${bills.length}
   --cost:${self.cost}-gain:${self.gain}-frozenGain:${self.frozenGain}-frozenCost:${self.frozenCost}
   --totalBet:${cost}-totalGain:${gain}
   -- data:${util.inspect(bills, false, 10)} creditMergeWallet._recommit `);

    self.gain = utils.number.add(self.gain, gain);
    self.cost = utils.number.add(self.cost, cost);
    self.frozenGain = utils.number.add(self.frozenGain, gain);
    self.frozenCost = utils.number.add(self.frozenCost, cost);

    ++self.lastIndex;
    self._commitBill(wagerId, true);

}

proto._stopTimer = function () {
    clearTimeout(this.timerId);
    this.timerId = null;
}

proto._saveAreaPlayerHistoryAsync = function (wagerId, idx, cost, gain, beforeBalance, afterBalance) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}
   --bet:${cost}-gain:${gain}
   -- creditMergeWallet._saveAreaPlayerHistoryAsync `);

    let self = this;
    let beginIdx = 0;
    let endIdx = 0;
    let areaId = self.areaId;
    let playerId = self.playerId;

    return P.resolve()
        .then(() => {
            let dao = self.app.controllers.daoMgr.getAreaPlayerDao();

            return dao.findOneAsync(areaId, playerId, true, self.app.getServerId());
        })
        .then((data) => {
            if (!!data) {
                data = data.toObject();

                data._id = wagerId;
                data.cost = cost;
                data.gain = gain;
                data.lastFireTime = utils.timeConvert(self.lastFireTime);
                data.createTime = utils.timeConvert(Date.now(), true);
                data.roundID = self.roundID; //[wagerId, idx].join('_');
                data.beforeBalance = beforeBalance || self.quota;
                data.afterBalance = afterBalance || self.amount;

                self.quota = self.amount;

                data.isBonusGame = self.isBonusGame[wagerId] || 0;

                let dao = self.app.controllers.daoMgr.getAreaPlayerHistoryDao();
                return dao.createAsync(data);
            } else {
                return P.reject('areaPlayer not found');
            }
        })
        .then((data) => {
            delete self.isBonusGame[wagerId];

            if (!data) {
                return P.reject('areaPlayerHistory save fail');
            } else {
                // data['isSingleWallet'] = 1;
                // data['gameTypeId'] = self.gameTypeId;
                // self.app.controllers.wagers.addWagers(self.playerId, data);

                let gameTokensDao = self.app.controllers.daoMgr.getGameTokenDao();
                beginIdx = self.beginIdx + 1;
                endIdx = self.beginIdx + idx;
                self.beginIdx = endIdx;
                return gameTokensDao.doSubReportDone(self.playerId, self.gameId, wagerId, beginIdx, endIdx, cost, gain)
            }
        })
        .then((data) => {
            if (!data) {
                logger.error(`pId:${this.playerId}-gId:${this.gameId}
       --wagerId:${wagerId}-idx:${idx}
       --beginIdx:${beginIdx}-endIdx:${endIdx}
       --bet:${cost}-gain:${gain}`)
            }
        })
        .catch(err => {
            logger.error(`pId:${self.playerId}-gId:${self.gameId}--areaId:${self.areaId}
     --wagerId:${wagerId}-idx:${idx}-cost:${cost}-gain:${gain}
     --creditMergeWallet._saveAreaPlayerHistoryAsync error: 
    `, err);
        })
}

proto._delAreaPlayerHistoryAsync = function (wagerId) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}
   -- creditMergeWallet._delAreaPlayerHistoryAsync `);

    let self = this;

    return P.resolve()
        .then(() => {
            let dao = self.app.controllers.daoMgr.getAreaPlayerHistoryDao();

            return dao.removeByIdAsync(wagerId);
        })
        .then((data) => {
            if (!data) {
                return P.reject('areaPlayerHistory remove fail wagerId ' + wagerId);
            } else {
                logger.debug(`pId:${this.playerId}-gId:${this.gameId}
     --wagerId:${wagerId}
     -- creditMergeWallet._delAreaPlayerHistoryAsync remove succ `);
            }
        })
        .catch(err => {
            logger.error(`pId:${self.playerId}-gId:${self.gameId}
     --wagerId:${wagerId}
     --creditMergeWallet._delAreaPlayerHistoryAsync error: 
    `, err);
        })
}

proto.reward = function (cash, conv, ratio, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --reward:${cash}--ratio:${ratio}--conv:${conv}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.reward `);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} creditMergeWallet.reward error: stoped is true `, {
            cash,
            ratio
        });

        return null;
    }

    if (conv) {
        ratio = ratio || self.ratio;
        cash = utils.scoreToCash(cash, ratio);
    }

    self.gain = utils.number.add(self.gain, cash);
    self.frozenGain = utils.number.add(self.frozenGain, cash);
    ++self.lastIndex;

    self._registerCallBack(self.wagerId, self.lastIndex, cb);

    if (!self.buffers[self.wagerId]) {
        self.buffers[self.wagerId] = []
    }
    self.buffers[self.wagerId].push({idx: self.lastIndex, bet: 0, gain: cash});
    self._startCheckTimer();

    return {cash, wagerId: this.wagerId, lastIndex: self.lastIndex};
}

proto.flushAsync = async function () {
    logger.info(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.flushAsync `);

    let self = this;
    let sync = self.app.get('sync');

    if (self.stoped) {
        return null;
    }

    self.stoped = true;
    self.disable = true;

    return P.resolve()
        .then(() => {
            if (!!self.timerId) {
                self._stopTimer();
                self._timerHandle();
            }
        })
        .then(() => {
            return new P((resolve, reject) => {
                return this.billChecker.stop(consts.BillType.betWin, true, (err, data) => {
                    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
          --err:${!!err}-dataLen:${!data ? null : data.result.length}
           creditMergeWallet.stopBillChecher return
        `);

                    // 已經在 stop 等待 api 回傳，不需再 cb 一次
                    // if(!err) {
                    //   let result = data.result;

                    //   result.forEach(r => {
                    //     this._handleBillCallback(r.err, r.data);
                    //   })
                    // }

                    resolve();
                })
            })
        })
        .then(() => {
            let data = {
                playerId: self.playerId,
                gameId: self.gameId,
                amount: self.amount,

                cost: self.statCost,
                gain: self.statGain,
                lastIndex: self.lastIndex,

                frozenCost: self.frozenCost,
                frozenGain: self.frozenGain,
                wagerId: self.wagerId,

                quota: self.quota,

                lastFireTime: self.lastFireTime
            }

            return new P((resolve, reject) => {
                sync.flush('wallet.batchSave', self.playerId, data, function (err, res) {
                    if (!err) {
                        resolve(res);
                    } else {
                        reject(err);
                        logger.error(`pId:${self.playerId}-gId:${self.gameId} creditMergeWallet.flushAsync error `, err);
                    }
                })
            })
        })
}

/**
 * bills - [{wId, idx}]
 * */
proto.cancelFreeGain = function (cash, conv, ratio, bills, from, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --cancelFreeGain:${cash}--ratio:${ratio}--conv:${conv}
  --bills:${util.inspect(bills, false, 10)}
  --from:${from}
  -this.wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.cancelFreeGain `);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} creditMergeWallet.cancelFreeGain error: stoped is true `, {
            cash,
            ratio
        });

        return null;
    }

    // 沒有需要取消免費子彈的就 return
    if (bills.length == 0) {
        // if(cash == 0 && bills.length == 0) {
        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
    --cancelFreeGain:${cash}--ratio:${ratio}--conv:${conv}
    --bills:${util.inspect(bills, false, 10)}
    -wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.cancelFreeGain invalid `);
        return;
    }

    if (conv) {
        ratio = ratio || self.ratio;
        cash = utils.scoreToCash(cash, ratio);
    }

    ++self.lastIndex;

    let cancelBills = {};
    bills.forEach(v => {
        if (!cancelBills[v.wId]) {
            cancelBills[v.wId] = [];
        }

        cancelBills[v.wId].push(v);
    });

    let keys = Object.keys(cancelBills);

    keys.forEach(k => {
        let cancelRet = self.billChecker.cancel(consts.BillType.betWin, [{wId: k}]);
        // 找不到還未送出 betAndWin 的免費子彈就 return
        if (cancelRet.count == 0) {
            // if(cancelRet.count == 0 && k != self.wagerId) {
            logger.warn(`pId:${this.playerId}-gId:${this.gameId}
        --cancelFreeGain:${cash}--ratio:${ratio}--conv:${conv}
        --cancelBills:${util.inspect(cancelBills[k], false, 10)}
        --cancelwId:${k}
        -this.wagerId:${this.wagerId}-idx:${this.lastIndex} creditMergeWallet.cancelFreeGain cancel fail `);

            // self._delAreaPlayerHistoryAsync(k);
            return;
        }

        // 有找到還未送出 betAndWin 的免費子彈，扣掉獲得的 gain
        self.gain = utils.number.sub(self.gain, cancelRet.gain);
        self.cost = utils.number.sub(self.cost, cancelRet.cost);
        self.frozenGain = utils.number.sub(self.frozenGain, cancelRet.gain);
        self.frozenCost = utils.number.sub(self.frozenCost, cancelRet.cost);

        if (!!self.buffers[k]) {
            cancelBills[k].forEach(b => {
                let index = self.buffers[k].findIndex(t => {
                    return b.idx == t.idx;
                });

                if (index != -1) {
                    let arr = self.buffers[k].splice(index, 1);

                    if (k == self.wagerId) {
                        self.gain = utils.number.sub(self.gain, arr[0].gain);
                        self.cost = utils.number.sub(self.cost, arr[0].bet);
                        self.frozenGain = utils.number.sub(self.frozenGain, arr[0].gain);
                        self.frozenCost = utils.number.sub(self.frozenCost, arr[0].bet);
                    }
                }
            });

            if (self.buffers[k].length == 0) {
                delete self.buffers[k];
            } else {
                if (k != self.wagerId) {
                    self._recommit(k);
                }
            }
        }
    });

    self._batchSave();
    self._registerCallBack(self.wagerId, self.lastIndex, cb);

    let wagerId = self.wagerId;
    let idx = self.lastIndex;
    let err = null;
    let data = {
        wagerId: wagerId, //
        idx: idx,     //
        betSucc: false, // 平台扣款成功
        winSucc: false, // 平台加钱成功
        amount: self.getRealBalance()  // 平台余额
    };

    setImmediate(() => {
        self._invokeCallBack(wagerId, idx, err, data);
    })

    return {cash, wagerId: this.wagerId, lastIndex: self.lastIndex};
}

proto.debugGetWeaponBetFail = function (wId, idx) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -wagerId:${wId}-idx:${idx} 
  creditMergeWallet.debugGetWeaponBetFail `);

    if (!!this.billChecker) {
        this.billChecker.blockBillAndFail(wId, idx, 6000, false)
    }
}

proto.checkLag = function () {
    let self = this;
    try {
        // 贏分未送出，暫不給玩家使用
        if (utils.number.sub(self.amount, self.cost) <= 0) {
            logger.warn(`[creditMergeWallet][checkLag] playerId: ${this.playerId}, quota: ${self.quota}, amount: ${self.amount}, gain: ${self.gain}, cost: ${self.cost}, ratio: ${self.ratio}`);
            return true;
        }
        return false;
    } catch (err) {
        logger.error(`[creditMergeWallet][checkLag] playerId: ${this.playerId}, quota: ${self.quota}, amount: ${self.amount}, gain: ${self.gain}, cost: ${self.cost}, ratio: ${self.ratio}, err:`, err);
        return false;
    }
}