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
let MemoryWallet = require('./memoryWallet');
let BillChecker = require('./billChecker');

// const MAX_FROZEN_COST = 100;  // 可允許的最大未結帳cost
// let MAX_FROZEN_COST = 100;  // 可允許的最大未結帳cost

module.exports = singleWallet = function (app, playerId, gameId, tableId, player, maxFrozenCost) {
    MemoryWallet.call(this, app, playerId, gameId, tableId);

    this.fetchAndUpdateAmount = true;
    this.billChecker = new BillChecker(app, playerId, gameId, player);
    this.billType = consts.BillType.betThenWin;

    this.isBonusGame = {};
    this.maxFrozenCost = maxFrozenCost;
}
util.inherits(singleWallet, MemoryWallet);

let proto = singleWallet.prototype;
let cort = P.coroutine;

proto.onInitAfter = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId} singleWallet.onInitAfter `);

    return true;
}

proto.initAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet.initAsync `);

    let self = this;
    let dao = self.app.controllers.daoMgr.getGameTokenDao();

    if (!self.disable) {
        return P.reject('wallet already init');
    }

    return P.resolve()
        .then(() => {
            return dao.findOneAsync(self.playerId, self.gameId, true);
        })
        .then((data) => {
            if (!!data && self.amount <= data.amount && data.state == consts.WalletState.init) {
                self.amount = data.amount;
                self.ratio = data.ratio;
                self.wagerId = data.wagerId;
                self.gain = 0;
                self.cost = 0;

                self.statGain = data.gain;
                self.statCost = data.cost;
                self.walletType = data.walletType;

                self.frozenCost = data.frozenCost;
                self.frozenGain = data.frozenGain;

                self.quota = data.quota;

                self.gameTypeId = data.gameTypeId;

                self.disable = false;

                return self.onInitAfter();
            } else {
                self.disable = true;

                return false;
            }
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId} singleWallet.initAsync error `, err);

            return false;
        })
}

proto.bet = function (score) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --bet:${score},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet.bet `);

    let self = this;
    if (self.disable || self.stoped) {
        return null;
    }

    let cash = utils.scoreToCash(score, self.ratio);
    if (self.amount + self.gain < self.cost + cash) {
        return null;
    }

    if (self.frozenCost >= self.maxFrozenCost) {
        return null;
    }

    self.cost = utils.number.add(self.cost, cash);

    return {score, cash, ratio: self.ratio};
}

proto.betResult = function (winScore, ratio, betCash, otherData, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --winScore:${winScore},ratio:${ratio}, betCash:${betCash},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex}--otherData:${JSON.stringify(otherData)} singleWallet.betResult `);
    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} singleWallet.betResult error: stoped is true `, {
            winScore,
            ratio,
            betCash
        });

        return null;
    }

    if (otherData.isBonusGame) self.isBonusGame[this.wagerId] = otherData.isBonusGame;

    if (Math.abs(betCash) > 0 &&
        (otherData.shootType === consts.FishType.BAZOOKA ||
            otherData.shootType === consts.FishType.DRILL ||
            otherData.shootType === consts.FishType.LASER)
    ) {
        logger.info(`[singleWallet][betResult] weapon be changed normal. playerId: ${this.playerId}, shootType: ${otherData.shootType}, betCash: ${betCash}`);
        let bet_res = self.bet(betCash);
        if (!bet_res) {
            logger.info(`[singleWallet][betResult] bet fail. playerId: ${this.playerId}, shootType: ${otherData.shootType}, bet_res: ${bet_res}`);
            return null;
        }
    }

    let cash = utils.scoreToCash(winScore, ratio);
    self.gain = utils.number.add(self.gain, cash);

    self.frozenCost = utils.number.add(self.frozenCost, betCash);
    self.frozenGain = utils.number.add(self.frozenGain, cash);
    ++self.lastIndex;

    self._registerCallBack(self.wagerId, self.lastIndex, cb);
    if (betCash > 0 || cash > 0) {
        self.billChecker.betThenWin(self.wagerId, self.lastIndex, betCash, cash, false, self._handleBillCallback.bind(this));
    } else {
        let wagerId = self.wagerId;
        let idx = self.lastIndex;
        let err = null;
        let data = {
            wagerId: wagerId, //
            idx: idx,     //
            betSucc: true, // 平台扣款成功
            winSucc: true, // 平台加钱成功
            amount: self.getRealBalance()  // 平台余额
        };

        setImmediate(() => {
            self._invokeCallBack(wagerId, idx, err, data);
        })
    }

    return {winScore, cash, ratio, lastIndex: self.lastIndex, wagerId: self.wagerId};
}

proto._handleBillCallback = function (err, data) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
  --frozenCost:${this.frozenCost}-frozenGain:${this.frozenGain}
  --error:${!!err} --respone:${util.inspect(data, false, 10)}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet._handleBillCallback `);

    let self = this;
    let succ = false;
    const {wagerId, idx, betSucc, winSucc} = data;

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

    if (!err && betSucc && winSucc) {
        // self.cost = utils.number.sub(self.cost, data.cost);
        // self.gain = utils.number.sub(self.gain, data.gain);
        //
        // self.frozenCost = utils.number.sub(self.frozenCost, data.cost);
        // self.frozenGain = utils.number.sub(self.frozenGain, data.gain);

        self.statCost = utils.number.add(self.statCost, data.cost);
        self.statGain = utils.number.add(self.statGain, data.gain);

        self._batchSave();

        succ = true;
    } else {
        self.disable = true;
        self._disableCheck();

        succ = false;
    }
    let done = self._invokeCallBack(wagerId, idx, err, data);

    if (!done) {
        self.billChecker.setPaused(true);
    }

    return succ;
}

proto.reward = function (cash, conv, ratio, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --reward:${cash}--ratio:${ratio}--conv:${conv}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet.reward `);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} singleWallet.reward error: stoped is true `, {
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
    self.billChecker.betThenWin(self.wagerId, self.lastIndex, 0, cash, false, self._handleBillCallback.bind(this));

    return {cash, wagerId: this.wagerId, lastIndex: self.lastIndex};
}

proto.flushAsync = function () {
    logger.info(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet.flushAsync `);

    let self = this;
    let sync = self.app.get('sync');

    if (self.stoped) {
        return null;
    }

    self.stoped = true;
    self.disable = true;

    return P.resolve()
        .then(() => {
            return new P((resolve, reject) => {
                return this.billChecker.stop(consts.BillType.betThenWin, true, (err, data) => {
                    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
          --err:${!!err}-dataLen:${!data ? null : data.result.length}
           singleWallet.stopBillChecher return
        `);

                    try {
                        if (!err) {
                            let result = data.result;

                            result.forEach(r => {
                                this._handleBillCallback(r.err, r.data);
                            })
                        }

                        resolve();
                    } catch (err) {
                        logger.error(`pId:${this.playerId}-gId:${this.gameId}
          --err:${!!err}-dataLen:${!data ? null : data.result.length}
           singleWallet.stopBillChecher error
        `, err);

                        resolve();
                    }

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
                        logger.error(`pId:${self.playerId}-gId:${self.gameId} singleWallet.flushAsync error `, err);
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
  -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet.cancelFreeGain `);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} singleWallet.cancelFreeGain error: stoped is true `, {
            cash,
            ratio
        });

        return null;
    }

    if (conv) {
        ratio = ratio || self.ratio;
        cash = utils.scoreToCash(cash, ratio);
    }

    ++self.lastIndex;
    let cancelRet = self.billChecker.cancel(consts.BillType.betThenWin, bills);

    if (cancelRet.count != bills.length || cancelRet.cost > 0 || cancelRet.gain != cash) {
        logger.warn(`pId:${this.playerId}-gId:${this.gameId}
    --cancelFreeGain:${cash}--ratio:${ratio}--conv:${conv}
    --cancelRet:${util.inspect(cancelRet, false, 10)}-bills:${util.inspect(bills, false, 10)}
    -wagerId:${this.wagerId}-idx:${this.lastIndex} singleWallet.cancelFreeGain `);
    }

    self.gain = utils.number.sub(self.gain, cancelRet.gain);
    self.frozenGain = utils.number.sub(self.frozenGain, cancelRet.gain);

    self.billChecker.setPaused(false);
    self.billChecker.doHandle(consts.BillType.betThenWin);

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
