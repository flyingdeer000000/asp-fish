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


module.exports = clipSingleWallet = function (app, playerId, gameId, tableId, player, clipAmount, reloadAmount) {
    MemoryWallet.call(this, app, playerId, gameId, tableId);

    this.clipAmount = clipAmount;
    this.reloadAmount = reloadAmount;
    this.charging = false;

    this.isBonusGame = {};
    this.billChecker = new BillChecker(app, playerId, gameId, player);
}
util.inherits(clipSingleWallet, MemoryWallet);

let proto = clipSingleWallet.prototype;
let cort = P.coroutine;

proto.onInitAfter = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId} clipSingleWallet.onInitAfter `);

    return P.resolve(0)
        .then(() => {
            return this._rechargeCheckAsync();
        })
}

proto.initAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet.initAsync `);

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
            logger.error(`pId:${this.playerId}-gId:${this.gameId} clipSingleWallet.initAsync error `, err);

            return false;
        })
}

proto.bet = function (score) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --bet:${score},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet.bet `);

    let self = this;
    if (self.disable || self.stoped) {
        return null;
    }

    let cash = utils.scoreToCash(score, self.ratio);
    if (self.amount + self.gain < self.cost + cash) {
        self._rechargeCheckAsync();

        return null;
    }

    self.cost = utils.number.add(self.cost, cash);
    self._rechargeCheckAsync();

    return {score, cash, ratio: self.ratio};
}

proto.betResult = function (winScore, ratio, betCash, otherData, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --winScore:${winScore},ratio:${ratio}, betCash:${betCash},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex}--otherData:${JSON.stringify(otherData)} clipSingleWallet.betResult `);
    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} clipSingleWallet.betResult error: stoped is true `, {
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
        logger.info(`[clipSingleWallet][betResult] weapon be changed normal. playerId: ${this.playerId}, shootType: ${otherData.shootType}, betCash: ${betCash}`);
        let bet_res = self.bet(betCash);
        if (!bet_res) {
            logger.info(`[clipSingleWallet][betResult] bet fail. playerId: ${this.playerId}, shootType: ${otherData.shootType}, bet_res: ${bet_res}`);
            return null;
        }
    }

    let cash = utils.scoreToCash(winScore, ratio);
    self.gain = utils.number.add(self.gain, cash);

    self.statCost = utils.number.add(self.statCost, betCash);
    self.statGain = utils.number.add(self.statGain, cash);
    ++self.lastIndex;

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

    return {winScore, cash, ratio, lastIndex: self.lastIndex, wagerId: self.wagerId};
}

proto.getRealBalance = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-gain:${this.gain}-cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet.getRealBalance `);

    let self = this;

    let num = utils.number.add(self.amount, self.gain);
    num = utils.number.sub(num, self.cost);
    num = utils.number.add(num, self.quota);
    if (num < 0) {
        logger.warn(`[clipSingleWallet][getRealBalance] playerId: ${self.playerId}, balance < 0, balance is ${num}, amount: ${self.amount}, gain: ${self.gain}, cost: ${self.cost}, quota: ${self.quota}, ratio: ${self.ratio}`);
        num = 0;
    }
    return num;
}

proto.getRealTokens = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-gain:${this.gain}-cost:${this.cost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet.getRealTokens `);

    let self = this;

    let num = utils.number.add(self.amount, self.gain);
    num = utils.number.sub(num, self.cost);
    num = utils.number.add(num, self.quota);
    let amount = utils.cashToScore(num, self.ratio);
    if (amount < 0) {
        logger.warn(`[clipSingleWallet][getRealTokens] playerId: ${self.playerId}, balance < 0, balance is ${amount}, amount: ${self.amount}, gain: ${self.gain}, cost: ${self.cost}, quota: ${self.quota}, ratio: ${self.ratio}`);
        amount = 0;
    }
    return amount;
}

proto.flushAsync = function () {
    logger.info(`pId:${this.playerId}-gId:${this.gameId}
  -amount:${this.amount}-statGain:${this.statGain}-statCost:${this.statCost}-ratio:${this.ratio}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet.flushAsync `);

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

    self.stoped = true;
    self.disable = true;

    return P.resolve(0)
        .then(() => {
            return self._summaryAsync();
        })
        .then(() => {
            data.amount = self.amount;
            data.quota = self.quota;
            return new P((resolve, reject) => {
                sync.flush('wallet.batchSave', self.playerId, data, function (err, res) {
                    if (!err) {
                        resolve(res);
                    } else {
                        reject(err);
                        logger.error(`pId:${self.playerId}-gId:${self.gameId} clipSingleWallet.flushAsync error `, err);
                    }
                })
            })
        })
}

//callBet 从平台预扣款
proto._rechargeCheckAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --amount:${this.amount}-quota:${this.quota}-clip:${this.clipAmount}-reload:${this.reloadAmount}
  --wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet._rechargeCheckAsync `);

    let self = this;

    let clipBalance = self.amount + self.gain - self.cost;
    if (clipBalance > self.reloadAmount) {
        return P.resolve(true);
    }

    if (self.charging) {
        return P.resolve(true);
    }

    self.charging = true;

    return P.resolve(0)
        .then(() => {
            return new P((resolve, reject) => {
                self.billChecker.bet(self.wagerId, self.lastIndex, self.clipAmount, false, (err, data) => {
                    logger.debug(`pId:${self.playerId}-gId:${self.gameId}
        --error:${!!err} --respone:${util.inspect(data, false, 10)}
        -wagerId:${self.wagerId}-idx:${self.lastIndex} clipSingleWallet._rechargeCheckAsync `);

                    const {wagerId, idx, betSucc} = data;

                    if (data.hasOwnProperty('amount')) {
                        self.balanceUpdateTime = Date.now();

                        self.quota = data.amount;
                    }

                    self.charging = false;
                    if (!err && betSucc) {
                        self.balanceUpdateTime = Date.now();

                        self.amount = utils.number.add(self.amount, data.cost);

                        resolve(true);
                    } else {
                        resolve(false);
                    }

                    return true;
                })
            })
        })
        .catch(err => {
            logger.error(`pId:${self.playerId}-gId:${self.gameId}
    -wagerId:${self.wagerId}-idx:${self.lastIndex} clipSingleWallet._rechargeCheckAsync error `, err);

            self.charging = false;
            return false;
        })
}

proto._summaryAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --amount:${this.amount}-quota:${this.quota}-clip:${this.clipAmount}
  --gain:${this.gain}-cost:${this.cost}
  --statGain:${this.statGain}-statCost:${this.statCost}
  --wagerId:${this.wagerId}-idx:${this.lastIndex} clipSingleWallet._summaryAsync `);

    let self = this;
    let clipBalance = utils.number.add(self.amount, self.statGain);
    clipBalance = utils.number.sub(clipBalance, self.statCost);

    if (clipBalance < 0) {
        logger.error(`pId:${self.playerId}-gId:${self.gameId}
    -wagerId:${self.wagerId}-idx:${self.lastIndex} clipSingleWallet._summaryAsync error `, err);

        return P.resolve(false);
    }

    if (clipBalance == 0) {
        return P.resolve(true);
    }

    return P.resolve(0)
        .then(() => {
            return new P((resolve, reject) => {
                self.billChecker.win(self.wagerId, self.lastIndex, clipBalance, 1, false, (err, data) => {
                    logger.debug(`pId:${self.playerId}-gId:${self.gameId}
        --error:${!!err} --respone:${util.inspect(data, false, 10)}
        -wagerId:${self.wagerId}-idx:${self.lastIndex} clipSingleWallet._summaryAsync `);

                    const {wagerId, idx, winSucc} = data;

                    if (!err && winSucc) {
                        self.balanceUpdateTime = Date.now();

                        self.amount = 0;
                        self.cost = 0;
                        self.gain = 0;
                        self.quota = data.amount;

                        resolve(true);
                    } else {
                        resolve(false);
                    }

                    return true;
                })
            })
        })
        .catch(err => {
            logger.error(`pId:${self.playerId}-gId:${self.gameId}
    -wagerId:${self.wagerId}-idx:${self.lastIndex} clipSingleWallet._summaryAsync error `, err);

            return false;
        })
}
