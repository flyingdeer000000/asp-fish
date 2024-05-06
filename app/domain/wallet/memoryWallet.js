/**
 * Created by GOGA on 2019/7/13.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('wallet', __filename);
const uuid = require('uuid/v1');
const _ = require('lodash');
let EventEmitter = require('events').EventEmitter;
let util = require('util');
let utils = require('../../utils/utils');
let consts = require('../../../share/consts');


module.exports = memoryWallet = function (app, playerId, gameId, tableId) {
    EventEmitter.call(this);

    logger.debug('memoryWallet ctor ', util.inspect({playerId, gameId}));

    this.app = app;
    this.playerId = playerId;
    this.gameId = gameId;
    this.tableId = tableId;

    this.amount = 0;
    this.ratio = 1;
    this.walletType = '';
    this.wagerId = '';

    this.cost = 0;
    this.gain = 0;

    this.statCost = 0;
    this.statGain = 0;
    this.lastIndex = 0;

    this.frozenCost = 0;
    this.frozenGain = 0;

    this.disable = true;
    this.callbacks = {};

    this.quota = 0;

    this.gameTypeId = 0;

    this.billChecker = null;

    this.fetchAndUpdateAmount = false;
    this.balanceUpdateTime = 0;

    this.lastFireTime = Date.now();
    this.stoped = false;
    this.billType = ''; // betResult 使用的billType

    this.waitObjects = {};
}
util.inherits(memoryWallet, EventEmitter);

let proto = memoryWallet.prototype;
let cort = P.coroutine;

proto.onInitAfter = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.onInitAfter `);

    return true;
}

proto.initAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.initAsync `);

    let self = this;
    let dao = self.app.controllers.daoMgr.getGameTokenDao();

    if (!self.disable) {
        return P.reject('wallet already init');
    }

    return P.resolve()
        .then(() => {
            return dao.findOneAsync(self.playerId, self.gameId, true);
        })
        .then(async (data) => {
            logger.debug('[memroyWallet][initAsync] gameTokens.findOneAsync: ', data);
            // if(!!data && self.amount <= data.amount && data.state == consts.WalletState.init) {
            if (!!data && self.amount <= data.amount &&
                // 狀態是 init 或 (settled 且 登入後有轉帳過)
                (data.state == consts.WalletState.init || (data.state == consts.WalletState.settled && data.allAreaExchange > 0))
            ) {
                self.amount = data.amount;
                self.ratio = data.ratio;
                self.wagerId = data.wagerId;
                self.gain = self.statGain = data.gain;
                self.cost = self.statCost = data.cost;
                self.walletType = data.walletType;
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
            logger.error(`pId:${this.playerId}-gId:${this.gameId} memWallet.initAsync error `, err);

            return false;
        })
}

proto.onExchangeAsync = function () {
    logger.error('Implemented by subclasses');

    return null;
}

proto.bet = function (score) {
    logger.error('Implemented by subclasses');

    return null;
}

/*
cb : (err, data) => {}
err: null 或 new Error()
data: {
  wagerId //
  idx     //
  betSucc // 平台扣款成功
  winSucc // 平台加钱成功
  amount  // 平台余额
}
* */
proto.betResult = function (winScore, ratio, betCash, otherData, cb) {
    logger.error('Implemented by subclasses');

    return null;
}

proto.reward = function (cash, conv, ratio, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --reward:${cash}--ratio:${ratio}--conv:${conv}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.reward `);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} memWallet.reward error: stoped is true `, {cash, ratio});

        return null;
    }

    if (conv) {
        ratio = ratio || self.ratio;
        cash = utils.scoreToCash(cash, ratio);
    }

    ++self.lastIndex;
    self.gain = utils.number.add(self.gain, cash);

    // self.statCost = utils.number.add(self.statCost, cash);
    self.statGain = utils.number.add(self.statGain, cash);

    self._batchSave(); // save memdb tokens
    self._registerCallBack(self.wagerId, self.lastIndex, cb);

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
        self._invokeCallBack(wagerId, idx, err, data); // 回傳
    })

    return {cash, wagerId: this.wagerId, lastIndex: self.lastIndex};
}

proto.getRealBalance = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-gain:${this.gain}-cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.getRealBalance `);

    let self = this;

    let num = utils.number.add(self.amount, self.gain);
    num = utils.number.sub(num, self.cost);
    if (num < 0) {
        logger.warn(`[memoryWallet][getRealBalance] playerId: ${self.playerId}, balance < 0, balance is ${num}, amount: ${self.amount}, gain: ${self.gain}, cost: ${self.cost}, quota: ${self.quota}, ratio: ${self.ratio}`);
        num = 0;
    }
    return num;
}

proto.getRealTokens = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-gain:${this.gain}-cost:${this.cost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.getRealTokens `);

    let self = this;

    let num = utils.number.add(self.amount, self.gain);
    num = utils.number.sub(num, self.cost);
    let amount = utils.cashToScore(num, self.ratio);
    if (amount < 0) {
        logger.warn(`[memoryWallet][getRealTokens] playerId: ${self.playerId}, balance < 0, balance is ${amount}, amount: ${self.amount}, gain: ${self.gain}, cost: ${self.cost}, quota: ${self.quota}, ratio: ${self.ratio}`);
        amount = 0;
    }
    return amount;
}

// 即時將memoryWallet寫回mongo，例如：stopFire結束後調用
proto.flushAsync = function () {
    logger.info(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.flushAsync `);

    let self = this;
    let sync = self.app.get('sync');
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

    if (self.stoped) {
        return null;
    }

    self.disable = true;
    self.stoped = true;

    return new P((resolve, reject) => {
        sync.flush('wallet.batchSave', self.playerId, data, function (err, res) {
            if (!err) {
                resolve(res);
            } else {
                reject(err);
                logger.error(`pId:${self.playerId}-gId:${self.gameId} memWallet.flushAsync error `, err);
            }
        })
    })
}

proto.fetchBalance = function (cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-gain:${this.gain}-cost:${this.cost}
  -statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.fetchBalance `);

    if (this.stoped) {
        return;
    }

    let checkTime = this.app.controllers.fishHunterConfig.getParamDefinConfig().updateSingleWalletBalanceTime * 1000;
    let now = Date.now();

    if (now - this.balanceUpdateTime < checkTime) {
        cb && cb(null, {update: false, amount: this.quota, playerId: this.playerId});
        return;
    }

    if (!!this.billChecker) {
        this.billChecker.fetchBalance(this.wagerId, this.lastIndex, false, (err, data) => {
            logger.debug(`pId:${this.playerId}-gId:${this.gameId}
      --amount:${this.amount}-gain:${this.gain}-cost:${this.cost}
      --statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
      --return data:${util.inspect(data, false, 10)}
      --wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.fetchBalance `);

            if (!err && data.hasOwnProperty('amount')) {
                let update = data.amount != this.amount;

                if (this.fetchAndUpdateAmount) {
                    this.amount = data.amount;
                }

                this.quota = data.amount;
                this.balanceUpdateTime = Date.now();

                cb && cb(null, {update, amount: data.amount, playerId: this.playerId});

                this._disableCheck();

            } else {
                cb && cb(new Error('fetchBalance fail'));
            }

            return true;
        })
    } else {
        logger.error(`pId:${this.playerId}-gId:${this.gameId}
      -amount:${this.amount}-gain:${this.gain}-cost:${this.cost}
      -statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
      -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.fetchBalance billChecker is null `);
    }
}

proto.updateFireTime = function () {
    this.lastFireTime = Date.now();
}

/**
 * bills - [{wId, idx}]
 * */
proto.cancelFreeGain = function (cash, conv, ratio, bills, from, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --cancelFreeGain:${cash}--ratio:${ratio}--conv:${conv}
  --bills:${util.inspect(bills, false, 10)}
  --from:${from}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} memWallet.cancelFreeGain `);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} memWallet.cancelFreeGain error: stoped is true `, {
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
    self.gain = utils.number.sub(self.gain, cash);

    self.statGain = utils.number.sub(self.statGain, cash);

    self._batchSave();
    self._registerCallBack(self.wagerId, self.lastIndex, cb);

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

    return {cash, wagerId: this.wagerId, lastIndex: self.lastIndex};
}

// 扣回 cache wallet cost
proto.cancelFireCost = function (cash, conv, ratio, cb) {
    logger.debug('[memoryWallet][cancelFireCost], cash: %s, conv: %s, ratio: %s ', cash, conv, ratio);

    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} memWallet.cancelFreeGain error: stoped is true `, {
            cash,
            ratio
        });
        return null;
    }

    if (conv) {
        ratio = ratio || self.ratio;
        cash = utils.scoreToCash(cash, ratio);
    }

    self.cost = utils.number.sub(self.cost, cash);
    return self.cost;
}

// proto._scoreToCash = function (amt, ratio) {
//   return utils.number.workMultiply(amt, ratio)
// }

// proto._cashToScore = function (amt, ratio) {
//   return utils.number.workDivide(amt, ratio)
// }

proto._batchSave = function () {
    let self = this;
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

    // save memdb tokens
    self.app.get('sync').exec('wallet.batchSave', self.playerId, data, function (err, res) {
        if (!err) {
        } else {
            logger.error(`pId:${self.playerId}-gId:${self.gameId} memWallet._batchSave error `, err);
        }
    })
}

proto._registerCallBack = function (wagerId, idx, cb) {
    let key = [wagerId, idx].join('$');

    if (!this.callbacks[key]) {
        this.callbacks[key] = cb;
    } else {
        logger.warn(`${this.playerId}, ${wagerId}, ${idx} callback already exist `)
    }
}

proto._invokeCallBack = function (wagerId, idx, err, data) {
    let key = [wagerId, idx].join('$');

    if (!!this.callbacks[key]) {
        let cb = this.callbacks[key];
        delete this.callbacks[key];

        if (!cb) {
            return true;
        } else {
            return cb(err, data) // cb betResult
        }
    } else {
        logger.warn(`${this.playerId}, ${wagerId}, ${idx} callback not exist `);

        return true;
    }
}

proto._disableCheck = function () {
    if (this.disable && this.getRealBalance() > 0) {
        this.disable = false;

        setImmediate(() => {
            if (!!this.billType) {
                this.billChecker.doHandle(this.billType);
            }
        })
    }
}

proto.waitFor = function (wagerId, idx) {
    logger.debug(`memWallet.waitFor-${wagerId}-idx:${idx}`);

    if (!this.waitObjects[wagerId]) {
        this.waitObjects[wagerId] = {};
    }

    this.waitObjects[wagerId][idx] = 1;
}

proto.waitClear = function (wagerId, idx) {
    logger.debug(`memWallet.waitClear-${wagerId}-idx:${idx}`);
    let self = this;

    if (!this.waitObjects[wagerId] || !this.waitObjects[wagerId][idx]) {
        return;
    }

    this.waitObjects[wagerId][idx] = 0;

    let allDone = true;
    let keys = Object.keys(this.waitObjects[wagerId]);

    keys.forEach(k => {
        if (!!this.waitObjects[wagerId][k]) {
            allDone = false;
        }
    })


    if (!!self.billChecker && allDone) {
        logger.debug(`
      memWallet.waitClear-${wagerId}-idx:${idx}
      allDone:${allDone}
    `);

        delete this.waitObjects[wagerId];

        self.billChecker.setPaused(false);
        self.billChecker.doHandle(self.billType);
    }
}

proto.debugGetWeaponBetFail = function (wId, idx) {
    if (!!this.billChecker) {
        this.billChecker.blockBillAndFail(wId, idx, 6000, true)
    }
}

proto.checkLag = function () {
    return false;
}
