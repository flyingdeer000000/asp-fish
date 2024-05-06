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

module.exports = multipleWallet = function (app, playerId, gameId, tableId, player) {
    MemoryWallet.call(this, app, playerId, gameId, tableId);
    this.areaId = player.areaId;
}
util.inherits(multipleWallet, MemoryWallet);

let proto = multipleWallet.prototype;
let cort = P.coroutine;

proto.onExchangeAsync = function () {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}-wagerId:${this.wagerId}
  --amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -idx:${this.lastIndex} multipleWallet.onExchangeAsync `);

    let self = this;
    let gameTokensDao = self.app.controllers.daoMgr.getGameTokenDao();

    if (self.stoped) {
        return P.reject('wallet stoped');
    }

    return P.resolve()
        .then(() => {
            return gameTokensDao.findOneAsync(self.playerId, self.gameId, true);
        })
        .then((data) => {
            logger.debug(`pId:${this.playerId}-gId:${this.gameId}-wagerId:${this.wagerId}
    --amount:${this.amount},gain:${this.gain},cost:${this.cost}
     --data:${JSON.stringify(data.toObject())}
      -idx:${this.lastIndex} multipleWallet.onExchangeAsync `);

            // if(!!data && self.amount <= data.amount  && data.state == consts.WalletState.init) {
            if (!!data && self.amount <= data.amount &&
                // 狀態是 init 或 (settled 且 登入後有轉帳過)
                (data.state == consts.WalletState.init || (data.state == consts.WalletState.settled && data.allAreaExchange > 0))
            ) {
                self.amount = data.amount;
                self.ratio = data.ratio;
                self.wagerId = data.wagerId;
                self.quota = data.quota;

                self._batchSave();

                return self;
            } else {
                self.disable = true;
                return null;
            }
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId} multipleWallet.onExchangeAsync error `, err);
        })
}

proto.bet = function (score) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --bet:${score},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  --disable:${this.disable}
  -wagerId:${this.wagerId}-idx:${this.lastIndex} multipleWallet.bet `);

    let self = this;
    if (self.disable || self.stoped) {
        return null;
    }

    let cash = utils.scoreToCash(score, self.ratio);
    if (self.amount + self.gain < self.cost + cash) {
        return null;
    }

    self.cost = utils.number.add(self.cost, cash);
    return {score, cash, ratio: self.ratio};
}

proto.betResult = function (winScore, ratio, betCash, otherData, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
  --winScore:${winScore},ratio:${ratio}, betCash:${betCash},amount:${this.amount},gain:${this.gain},cost:${this.cost}
  -wagerId:${this.wagerId}-idx:${this.lastIndex}--otherData:${JSON.stringify(otherData)} multipleWallet.betResult `);
    let self = this;

    if (self.stoped) {
        logger.error(`pId:${this.playerId}-gId:${this.gameId} multipleWallet.betResult error: disabled is true `, {
            winScore,
            ratio,
            betCash
        });

        return null;
    }

    if (otherData.isBonusGame) {
        self.app.memdb.goose.transactionAsync(P.coroutine(function* () {
            let opts = {playerId: self.playerId, areaId: self.areaId};
            let areaPlayer = yield self.app.models.FishHunterAreaPlayers.findOneReadOnlyAsync(opts);
            if (!!areaPlayer && !areaPlayer.isBonusGame) {
                areaPlayer = yield self.app.models.FishHunterAreaPlayers.findOneAsync(opts);
                areaPlayer.isBonusGame = otherData.isBonusGame; // 更新玩家獎勵遊戲為 true
                yield areaPlayer.saveAsync();
            }
        }), self.app.getServerId());
    }

    if (Math.abs(betCash) > 0 &&
        (otherData.shootType === consts.FishType.BAZOOKA ||
            otherData.shootType === consts.FishType.DRILL ||
            otherData.shootType === consts.FishType.LASER)
    ) {
        logger.info(`[multipleWallet][betResult] weapon be changed normal. playerId: ${this.playerId}, shootType: ${otherData.shootType}, betCash: ${betCash}`);
        let bet_res = self.bet(betCash);
        if (!bet_res) {
            logger.info(`[multipleWallet][betResult] bet fail. playerId: ${this.playerId}, shootType: ${otherData.shootType}, bet_res: ${bet_res}`);
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
