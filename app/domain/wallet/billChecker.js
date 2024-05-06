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
const apiCode = require('../../expressRouter/apiServerStatus');

module.exports = billChecker = function (app, playerId, gameId, player) {
    this.app = app;
    this.playerId = playerId;
    this.gameId = gameId;
    this.player = player;
    this.stoped = false;
    this.paused = false;

    this.bills = {
        [consts.BillType.bet]: [],
        [consts.BillType.win]: [],
        [consts.BillType.betWin]: [],
        [consts.BillType.betThenWin]: [],
        [consts.BillType.fetchBalance]: [],
    };

    this.debugBillInfo = [];
}

let proto = billChecker.prototype;
let cort = P.coroutine;

proto.bet = function (wId, idx, cost, force, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-cost:${cost}
   billChecker.bet `);

    if (this.bills.bet.length == 0) {
        this.bills.bet.push({wId, idx, cost, cb});

        this._handleNextBet(consts.BillType.bet, force);
    } else {
        this.bills.bet.push({wId, idx, cost, cb});
    }

    return true;
}

proto._handleNextBet = function (type, force) {
    if (!this.bills[type] || this.bills[type].length == 0) {
        return;
    }
    const {wId, idx, cost, cb, cancel} = this.bills[type][0];

    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-cost:${cost}
   --force:${force}
   --stoped:${this.stoped}-paused:${this.paused}
   billChecker._handleNextBet `);

    if (this.paused) {
        return;
    }

    if (cancel) {
        this._handleBillError(type, {
            wagerId: wId,
            idx: idx,
            cost: cost,
            gain: 0,
            betSucc: false,
            winSucc: false
        }, 'handle bet cancel');
        let tmp = this.bills[type].shift();

        if (this.bills[type].length > 0 && (!this.stoped || force)) {
            this._handleNextBet(type, force);
        }

        return;
    }

    this.bills[type][0].defer = P.defer();

    P.resolve()
        .then(() => {
            return this._callBetAsync(cost, wId, idx);
        })
        .then(data => {
            let succ = true;
            if (!!cb) {
                if (!!data) {
                    data.wagerId = wId;
                    data.idx = idx;

                    if (!data.code) {
                        data.betSucc = true;
                        succ = cb(null, data);
                    } else {
                        data.betSucc = false;
                        succ = cb(new Error('bet fail: ' + data.code), data);
                    }
                } else {
                    data = {}
                    data.wagerId = wId;
                    data.idx = idx;
                    data.cost = cost;
                    data.betSucc = false;

                    succ = cb(new Error('bet fail'), data);
                }
            }

            if (succ) {
                let tmp = this.bills[type].shift();
                tmp.defer.resolve(tmp);

                if (this.bills[type].length > 0 && (!this.stoped || force)) {
                    this._handleNextBet(type, force);
                }
            } else {
                this._handleBillError(type, data, 'handle bet fail');
                let tmp = this.bills[type].shift();
                tmp.defer.resolve(tmp);
            }
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId}
     --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
     --force:${force}
     billChecker._handleNextBet `, err);
        })
}

proto.win = function (wId, idx, gain, cost, force, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-gain:${gain}
   billChecker.win `);

    if (this.bills.win.length == 0) {
        this.bills.win.push({wId, idx, gain, cost, cb});

        this._handleNextWin(consts.BillType.win, force);
    } else {
        this.bills.win.push({wId, idx, gain, cost, cb});
    }

    return true;
}

proto._handleNextWin = function (type, force) {
    if (!this.bills[type] || this.bills[type].length == 0) {
        return;
    }
    const {wId, idx, gain, cost, cb, cancel} = this.bills[type][0];

    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-gain:${gain}-cost:${cost}
   --force:${force}
   --stoped:${this.stoped}-paused:${this.paused}
   billChecker._handleNextWin `);

    if (this.paused) {
        return;
    }

    if (cancel) {
        this._handleBillError(type, {
            wagerId: wId,
            idx: idx,
            cost: cost || 0,
            gain: gain,
            betSucc: false,
            winSucc: false
        }, 'handle win cancel');
        let tmp = this.bills[type].shift();

        if (this.bills[type].length > 0 && (!this.stoped || force)) {
            this._handleNextWin(type, force);
        }

        return;
    }

    this.bills[type][0].defer = P.defer();

    P.resolve()
        .then(() => {
            return this._callWinAsync(gain, wId, idx, cost, false);
        })
        .then(data => {
            let succ = true;
            if (!!cb) {
                if (!!data) {
                    data.wagerId = wId;
                    data.idx = idx;
                    data.winSucc = true;

                    succ = cb(null, data);
                } else {
                    data = {}
                    data.wagerId = wId;
                    data.idx = idx;
                    data.gain = gain;
                    data.winSucc = false;

                    succ = cb(new Error('win fail'), data);
                }
            }

            if (succ) {
                let tmp = this.bills[type].shift();
                tmp.defer.resolve(tmp);

                if (this.bills[type].length > 0 && (!this.stoped || force)) {
                    this._handleNextWin(type, force);
                }
            } else {
                this._handleBillError(type, data, 'handle win fail');
                let tmp = this.bills[type].shift();
                tmp.defer.resolve(tmp);
            }
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId}
     --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
     --force:${force}
     billChecker._handleNextWin `, err);
        })
}

proto.betAndWin = function (wId, idx, cost, gain, force, wagersData, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
      --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
      billChecker.betAndWin `);
    this.bills.betWin.push({wId, idx, cost, gain, wagersData, cb});
    logger.info(`[billChecker][betAndWin] playerId: ${this.playerId}, wid: ${wId}, this.bills.betWin:`, this.bills.betWin);
    if (this.bills.betWin.length > 0) {
        this._handleNextBetAndWin(consts.BillType.betWin, force, wId, 'betAndWin');
    }

    // if (this.bills.betWin.length == 0) {
    //   this.bills.betWin.push({wId, idx, cost, gain, wagersData, cb});

    //   this._handleNextBetAndWin(consts.BillType.betWin, force);
    // }
    // else {
    //   this.bills.betWin.push({wId, idx, cost, gain, wagersData, cb});
    // }
    return true;
}

proto._handleNextBetAndWin = function (type, force, wagerId, from) {
    if (!this.bills[type] || this.bills[type].length == 0) {
        return;
    }
    const {wId, idx, cost, gain, cb, wagersData, cancel} = this.getBufferData(type, wagerId);
    // const {wId, idx, cost, gain, cb, wagersData, cancel} = this.bills[type][0];
    if (!wagerId || !wId) {
        return;
    }
    logger.info(`pId:${this.playerId}-gId:${this.gameId},-type:${type}
   wagerId: ${wId}
   --idx:${idx}-cost:${cost}-gain:${gain}
   --wagersData:${JSON.stringify(wagersData)}
   --cancel:${cancel}--force:${force}--stoped:${this.stoped}-paused:${this.paused}
   --from:${from}, billChecker._handleNextBetAndWin `);

    if (this.paused) {
        return;
    }

    if (cancel) {
        this._handleBillError(type, {
            wagerId: wId,
            idx: idx,
            cost: cost || 0,
            gain: gain,
            betSucc: false,
            winSucc: false
        }, 'handle betAndWin cancel');
        // let tmp = this.bills[type].shift();

        // if(this.bills[type].length > 0 && (!this.stoped || force)) {
        //   this._handleNextBetAndWin(type, force, wagerId, 'self');
        // }

        return;
    }

    // this.bills[type][0].defer = P.defer();

    P.resolve()
        .then(() => {
            return this._callBetAndWinAsync(cost, gain, wId, idx, wagersData);
            // if(cost > 0 || gain > 0) {
            //   return this._callBetAndWinAsync(cost, gain, wId, idx, wagersData);
            // }
            // else {
            //   return {
            //     wagerId: wId,
            //     idx: idx,
            //     cost: 0,
            //     gain: 0
            //   }
            // }
        })
        .then(data => {
            let succ = true;
            let cbData;
            if (!!cb) {
                cbData = {...data};
                cbData.wagerId = wId;
                cbData.idx = idx;
                cbData.cost = cost;
                cbData.gain = gain;
                cbData.betSucc = false;
                cbData.winSucc = false;

                if (!!data) {
                    cbData.afterBalance = data.afterBalance;
                    cbData.beforeBalance = data.beforeBalance;

                    if (!data.code) {
                        cbData.betSucc = true;
                        cbData.winSucc = true;
                        succ = cb(null, cbData); // cb 回 _handleBillCallback
                    } else {
                        succ = cb(new Error('[1] betAndWin fail: ' + data.code), cbData);
                    }
                } else {
                    succ = cb(new Error('[2] betAndWin fail'), cbData);
                }
            }

            let tmp;
            for (let i in this.bills[type]) {
                if (this.bills[type][i].wId == wagerId) {
                    tmp = _.cloneDeep(this.bills[type][i]);
                    this.bills[type].splice(i, 1); // 移除
                    break;
                }
            }

            // succ = _handleBillCallback 回傳結果
            if (succ) {
                // let tmp = this.bills[type].shift();
                if (tmp) tmp.defer.resolve(tmp);
                else
                    logger.warn(`[billChecker][_handleNextBetAndWin] succ: ${succ}, playerId: ${this.playerId}, gameId: ${this.gameId}, wagerId: ${wId}
        cbData: ${util.inspect(cbData, false, 10)}`);
                // if(this.bills[type].length > 0  && (!this.stoped || force)) {
                //   this._handleNextBetAndWin(type,force, wagerId, 'self_2');
                // }
            } else {
                this._handleBillError(type, cbData || data, 'handle betAndWin fail');
                // let tmp = this.bills[type].shift();
                if (tmp) tmp.defer.resolve(tmp);
                else
                    logger.warn(`[billChecker][_handleNextBetAndWin] succ: ${succ}, playerId: ${this.playerId}, gameId: ${this.gameId}, wagerId: ${wId}
        cbData: ${util.inspect(cbData, false, 10)}`);
            }
            logger.info(`pId:${this.playerId}-gId:${this.gameId},-type:${type}
    wagerId: ${wId} 
    cbData: ${util.inspect(cbData, false, 10)}
    billChecker._handleNextBetAndWin done`);
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
   --force:${force}
   billChecker._handleNextBetAndWin `, err);
        })
}

proto.getBufferData = function (type, wagerId) {
    let data = null;
    for (let i in this.bills[type]) {
        let item = this.bills[type][i];
        if (item.wId == wagerId) {
            this.bills[type][i].defer = P.defer();
            data = {
                wId: item.wId,
                idx: item.idx,
                cost: item.cost,
                gain: item.gain,
                cb: item.cb,
                wagersData: item.wagersData,
                cancel: item.cancel,
            };
            break;
        }
    }
    return data;
}

proto.betThenWin = function (wId, idx, cost, gain, force, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
   billChecker.betThenWin `);

    if (this.bills.betThenWin.length == 0) {
        this.bills.betThenWin.push({wId, idx, cost, gain, cb});

        this._handleNextBetThenWin(consts.BillType.betThenWin, force);
    } else {
        this.bills.betThenWin.push({wId, idx, cost, gain, cb});
    }

    return true;
}

proto._handleNextBetThenWin = function (type, force) {
    if (!this.bills[type] || this.bills[type].length == 0) {
        return;
    }
    const {wId, idx, cost, gain, cb, cancel} = this.bills[type][0];

    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
   --force:${force}
   --stoped:${this.stoped}-paused:${this.paused}
   billChecker._handleNextBetThenWin `);

    if (this.paused) {
        return;
    }

    if (cancel) {
        this._handleBillError(type, {
            wagerId: wId,
            idx: idx,
            cost: cost || 0,
            gain: gain,
            betSucc: false,
            winSucc: false
        }, 'handle betThenWin cancel');
        let tmp = this.bills[type].shift();

        if (this.bills[type].length > 0 && (!this.stoped || force)) {
            this._handleNextBetThenWin(type, force);
        }

        return;
    }

    this.bills[type][0].defer = P.defer();

    P.resolve()
        .then(() => {
            return this._callBetThenWinAsync(cost, gain, wId, idx);
        })
        .then(data => {
            let succ = true;
            if (!!cb) {
                if (!!data) {
                    if (!data.code) {
                        succ = cb(null, data);
                    } else {
                        succ = cb(new Error('betThenWin fail' + data.code), data);
                    }
                } else {
                    data = {}
                    data.wagerId = wId;
                    data.idx = idx;
                    data.cost = cost;
                    data.gain = gain;
                    data.betSucc = false;
                    data.winSucc = false;

                    succ = cb(new Error('betThenWin fail'), data);
                }
            }

            if (succ) {
                let tmp = this.bills[type].shift();
                tmp.defer.resolve(tmp);

                if (this.bills[type].length > 0 && (!this.stoped || force)) {
                    this._handleNextBetThenWin(type, force);
                }
            } else {
                this._handleBillError(type, data, 'handle betThenWin fail');
                let tmp = this.bills[type].shift();
                tmp.defer.resolve(tmp);
            }
        })
        .catch(err => {
            logger.error(`pId:${this.playerId}-gId:${this.gameId}
     --wagerId:${wId}-idx:${idx}-cost:${cost}-gain:${gain}
     --force:${force}
     billChecker._handleNextBetThenWin `, err);
        })
}

proto.fetchBalance = function (wId, idx, force, cb) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}
   billChecker.fetchBalance `);

    if (this.bills.fetchBalance.length == 0) {
        this.bills.fetchBalance.push({wId, idx, cb});

        this._handleFetchBalance(consts.BillType.fetchBalance, force);
    } else {
        this.bills.fetchBalance.push({wId, idx, cb});
    }

    return true;
}

proto._handleFetchBalance = function (type, force) {
    if (!this.bills[type] || this.bills[type].length == 0) {
        return;
    }
    const {wId, idx, cb} = this.bills[type][0];

    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wId}-idx:${idx}
   --force:${force}
   --stoped:${this.stoped}-paused:${this.paused}
   billChecker._handleFetchBalance `);

    P.resolve()
        .then(() => {
            return this._callFetchBalance(wId, idx);
        })
        .then(data => {
            this._invokeFetchBalanceCB(type, data)
        })
        .then((data) => {
            if (data && (!this.stoped || force)) {
                this._handleFetchBalance(type, force);
            }
        })
}

proto._invokeFetchBalanceCB = function (type, data) {
    const {wId, idx, cb} = this.bills[type][0];
    let succ = true;
    if (!!cb) {
        if (!!data) {
            data.wagerId = wId;
            data.idx = idx;
            data.fetchSucc = true;
            succ = cb(null, data);
        } else {
            data = {}
            data.wagerId = wId;
            data.idx = idx;
            data.fetchSucc = false;

            succ = cb(new Error('fetchBalance fail'), data);
        }
    }

    if (succ) {
        this.bills[type].shift();

        if (this.bills[type].length > 0) {
            return this._invokeFetchBalanceCB(type);
        }
    }

    return succ;
}

proto.stop = function (type, quickMode, callback) {
    this.stoped = true;
    let bills = this.bills[type];
    let result = []

    logger.info(`pId:${this.playerId}-gId:${this.gameId}
   --bet:${this.bills.bet.length}-win:${this.bills.win.length}
   --betWin:${this.bills.betWin.length}-betThenWin:${this.bills.betThenWin.length}
   --pause:${this.paused}-stop:${this.stoped}
   --billType:${type}-quickMode:${quickMode}
   --bills count:${bills.length}--bills:${JSON.stringify(bills)}
     billChecker.stop `);

    if (!bills || bills.length == 0) {
        callback && callback(null, {result});
        return;
    }

    let billCount = bills.length;
    let newCb = (err, data) => {
        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
     --data:${util.inspect(data, false, 10)}
     --billType:${type}-billCount:${billCount}
     billChecker.stop call return `);

        result.push({err, data});

        if (!!err) {
            this._handleBillError(type, data, err.message || 'stop call');
        }

        if (result.length == billCount) {
            callback && callback(null, {result});
        }

        return true;
    }


    if (type == consts.BillType.fetchBalance) {
        bills.forEach(v => {
            v.cb = newCb;
        });

        this._handleFetchBalance(type, true);
    } else {
        // let cost = 0;
        // let gain = 0;
        // const {defer} = bills[0];

        // let handler = {
        //   [consts.BillType.bet]: this._handleNextBet.bind(this),
        //   [consts.BillType.win]: this._handleNextWin.bind(this),
        //   [consts.BillType.betWin]: this._handleNextBetAndWin.bind(this),
        //   [consts.BillType.betThenWin]: this._handleNextBetThenWin.bind(this)
        // }

        // 改等待全部的帳單回傳，故使用for迴圈 // 舊機制是一次只送一張單，新機制是每3秒送一張單
        for (let i in bills) {
            let {defer, wagerId, cost, gain, idx, cb} = bills[i];
            P.resolve()
                .then(() => {
                    if (!!defer) return defer.promise;
                    else return null;
                })
                .then((data) => {

                    if (!!data) {
                        result.push({err: null, data});

                    } else {
                        let errMsg = type + ' cause stop fail';
                        let res = {
                            wagerId,
                            idx,
                            cost: cost || 0,
                            gain: gain || 0,
                            betSucc: false,
                            winSucc: false
                        };
                        this._handleBillError(type, res, errMsg);
                        result.push({err: new Error(errMsg), data: res})
                    }

                    // 全部都回來再 callBack 回去 flushAsync
                    if (result.length == billCount) {
                        callback && callback(null, {result});
                    }
                })

        }

        // 舊的 code
        // P.resolve()
        // .then(() => {
        //   if(!!defer) {
        //     return defer.promise;
        //   }
        //   else {
        //     return null;
        //   }
        // })
        // .then((data) => {

        //   if(bills.length > 0) {
        //     const {wId, idx} = bills[0];

        //     return this._callFetchBalance(wId, idx);
        //   }
        //   else {
        //     return null;
        //   }
        // })
        // .then((data) => {
        //   if(!!data) {
        //     bills.forEach(v => {
        //       if(_.isNumber(v.cost)) {
        //         cost += v.cost;
        //       }

        //       if(_.isNumber(v.gain)) {
        //         gain += v.gain;
        //       }

        //       v.cb = newCb;
        //     });

        //     let amount = data.amount;

        //     billCount = bills.length;
        //     if(amount + gain - cost < 0 || !quickMode) {
        //       if(bills.length > 0) wagerId = bills[0].wId;
        //       handler[type](type, true, wagerId, 'stop');
        //     }
        //     else {
        //       this._stopQuick(type, amount);
        //     }
        //   }
        //   else {
        //     if(bills.length > 0) {
        //       let errMsg = type + ' cause stop fetchBalance fail';
        //       bills.forEach(v => {
        //         let res = {
        //           wagerId: v.wId,
        //           idx: v.idx,
        //           cost: v.cost || 0,
        //           gain: v.gain || 0,
        //           betSucc: false,
        //           winSucc: false
        //         };
        //         this._handleBillError(type, res, errMsg);

        //         result.push({err: new Error(errMsg), data: res})
        //       });

        //       this.bills[type] = [];
        //       cb && cb(null, {result});
        //     }
        //     else {
        //       cb && cb(null , {result});
        //     }
        //   }
        // })
    }

}

proto.cleanup = function (type) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --${type}Count:${this.bills[type].length}
   --billType:${type}
     billChecker.cleanup `);

    this.bills[type] = [];
}

proto.doHandle = function (type) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
     --${type}Count:${this.bills[type].length}
     --billType:${type}
     --pause:${this.paused}-stop:${this.stoped}
     billChecker.doHandle `);

    if (this.paused || this.stoped) {
        return;
    }

    if (this.bills[type].length == 0) {
        return;
    }

    const {defer} = this.bills[type][0];

    if (!!defer) {
        return;
    }

    let handler = {
        [consts.BillType.bet]: this._handleNextBet.bind(this),
        [consts.BillType.win]: this._handleNextWin.bind(this),
        [consts.BillType.betWin]: this._handleNextBetAndWin.bind(this),
        [consts.BillType.betThenWin]: this._handleNextBetThenWin.bind(this)
    }

    handler[type](type, false, null, 'doHandle');
}

proto.cancel = function (type, cancelBills) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --${type}Count:${this.bills[type].length}
   --billType:${type}-cancelBills:${util.inspect(cancelBills, false, 10)}
     billChecker.cancel `);

    let bills = this.bills[type];
    let cancelCount = 0;
    let cancelCost = 0;
    let cancelGain = 0;

    cancelBills.forEach(v => {
        let index = bills.findIndex(b => {
            if (v.hasOwnProperty('idx')) {
                return (b.wId == v.wId && b.idx == v.idx);
            } else {
                return b.wId == v.wId;
            }
        });

        if (index != -1 && !bills[index].defer) {
            bills[index].cancel = true;

            ++cancelCount;
            cancelCost = utils.number.add(cancelCost, bills[index].cost);
            cancelGain = utils.number.add(cancelGain, bills[index].gain);
        }
    });

    return {count: cancelCount, cost: cancelCost, gain: cancelGain};
}

/**
 * bill - {wId, idx, cost, gain, cb}
 * */
proto.reorder = function (type, bill, matchIdx) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
    --${type}Count:${this.bills[type].length}
    --billType:${type}-bill:${util.inspect(bill, false, 10)}-matchIdx:${matchIdx}
    --pause:${this.paused}-stop:${this.stoped}
     billChecker.reorder `);

    let bills = this.bills[type];

    if (!bills || bills.length == 0) {
        return;
    }

    let index = bills.findIndex(b => {
        if (matchIdx) {
            return (b.wId == bill.wId && b.idx == bill.idx);
        } else {
            return b.wId == bill.wId;
        }
    });

    if (index == -1 || !!bills[index].defer) {
        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
     --${type}Count:${this.bills[type].length}
     --billType:${type}-bill:${util.inspect(bill, false, 10)}-matchIdx:${matchIdx}
     --index:${index}
     billChecker.reorder fail `);

        return;
    }

    for (let k in bill) {
        bills[index][k] = bill[k];
    }

    bills[index].cancel = false;
}

proto.setPaused = function (pause) {
    this.paused = pause;
}

proto._callBetAndWinAsync = P.coroutine(function* (bet, gain, wagerId, idx, wagersData) {
    let reData = {code: C.ERROR, afterBalance: null, beforeBalance: null};
    try {
        let self = this;
        let player = self.player;

        wagersData['wagerId'] = wagerId;
        wagersData['bet'] = bet;
        wagersData['gain'] = gain;
        let wagers = yield self.app.controllers.wagers.getWagerData(player, wagersData);
        if (!wagers) {
            logger.warn(`[billChecker][_callBetAndWinAsync] playerId: ${player._id}, wagers is ${wagers}, return null.`,);
            return reData;
        }
        // 回傳給 mongo 母單寫入 beforeBalance & afterBalance
        reData.afterBalance = wagers.NewQuota;
        reData.beforeBalance = wagers.OldQuota;

        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.betAndWin,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            upid: player.upid,
            playerId: player._id,
            launchToken: player.launchToken,
            deviceId: player.clientType,
            bet: bet,
            win: gain,
            isSingleWallet: player.isSingleWallet,
            ggId: 1,
            dsUseDc: player.dsUseDc,
            // for SW
            roundEnded: true,
            extTransactionId: '',
            gameType: 1,
            // for HB
            // platformPlayerId: player.platformPlayerId,
            // for 母單
            wagers: wagers,
            getWeapon: wagersData.getWeapon
        };

        logger.info('[billChecker][_callBetAndWinAsync][CallAPI] betAndWin ：', opts);

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}-cost:${bet}-gain:${gain}
   --opts:${util.inspect(opts, false, 10)}
   billChecker._callBetAndWinAsync `);

        let betAndWinRes = yield utils.httpPost(url, opts);

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}-cost:${bet}-gain:${gain}
   --betAndWinRes:${util.inspect(betAndWinRes, false, 10)}
   billChecker._callBetAndWinAsync return `);


        let debugInfo = this.hasDebug(wagerId, idx);
        if (!!debugInfo) {
            yield P.delay(debugInfo.timeout);

            betAndWinRes = null;
        }

        if (!!betAndWinRes && betAndWinRes.status == apiCode.SUCCESS) {
            bet = betAndWinRes.data.realbet || bet; // 實際 bet

            if (!!betAndWinRes.data.status) {
                // call API 失敗 // api 有回傳 status，代表 call 介接方失敗

                // 試玩帳號 不進rc統計
                if (!player.demo) {
                    // cost已扣掉所以用GAIN補回
                    if (bet > 0) self.app.controllers.fishHunterRC.addRecord(player.currency, player.gameId, player.tableLevel, bet, self.app.controllers.fishHunterRC.RC_EVENT.GAIN, player.dc, self.app.betSetting.exchangeRate);
                    // gain已加上所以用COST補回
                    if (gain > 0) self.app.controllers.fishHunterRC.addRecord(player.currency, player.gameId, player.tableLevel, gain, self.app.controllers.fishHunterRC.RC_EVENT.COST, player.dc, self.app.betSetting.exchangeRate);
                }

                switch (betAndWinRes.data.status) {
                    case C.API_RETURN_TOKEN_EXPIRED: // Token 過期
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.API_AUTH_FAIL);
                        return reData;
                    case C.CREDIT_QUOTA_NOT_ENOUGH: // 信用額度不足
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.INSUFFICIENT_CREDIT_LIMIT);
                        return reData;
                    case C.PLAYER_OUT_GOLD: // 扣款失敗: 餘額不足
                        reData.amount = betAndWinRes.data.creditAmount;
                    case C.API_AUTH_TIME_OUT: // 重試(retry)
                        reData.cost = bet;
                        reData.gain = gain;
                        reData.code = betAndWinRes.data.status;
                        return reData;
                    case C.PLAYER_OUT_GOLD: // 扣款失敗: 餘額不足
                    default: // 其他失敗原因
                        logger.warn(`[billChecker][_callBetAndWinAsync][RES] playerId: ${player._id}, wagerId: ${wagerId}, betAndWin API failed ： ${JSON.stringify(betAndWinRes)}`);
                        return reData;
                }
            } else {
                // call API 成功
                logger.info(`[billChecker][_callBetAndWinAsync][RES] playerId: ${player._id}, wagerId: ${wagerId}, betAndWin API ： ${JSON.stringify(betAndWinRes)}`);
                delete reData.code;
                reData.cost = bet;
                reData.gain = gain;
                reData.amount = betAndWinRes.data.creditAmount;
                return reData;
            }
        } else {
            // call webconnector 失敗
            logger.warn(`[billChecker][_callBetAndWinAsync][RES] playerId: ${player._id}, wagerId: ${wagerId}, betAndWin webConnector failed: ${JSON.stringify(betAndWinRes)}`);
            // 回傳 API超時，讓定時檢查 retry 去檢查單是否存在，以免漏單 // api太久未回傳有時候會跳這邊
            reData.code = C.API_AUTH_TIME_OUT; // API超時
            return reData;
        }
    } catch (err) {
        if (!!err.error && typeof err.error == 'object') {
            let msg = _.toString(err.error);
            if (msg.indexOf('socket hang up') > -1) {
                reData.code = C.API_AUTH_TIME_OUT; // API超時
                logger.info(`[billChecker][_callBetAndWinAsync][RES] playerId: ${this.player._id}, wagerId: ${wagerId}, socket hang up.`);
            } else {
                logger.warn(`[billChecker][_callBetAndWinAsync][RES] playerId: ${this.player._id}, wagerId: ${wagerId}, err:`, err);
            }
        } else {
            logger.error(`[billChecker][_callBetAndWinAsync] playerId: ${this.player._id}, wagerId: ${wagerId}, catch err:`, err);
        }
        return reData;
    }
});

proto._callBetAsync = P.coroutine(function* (bet, wagerId, idx) {

    try {
        let self = this;
        let player = self.player;

        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.bet,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            upid: player.upid,
            playerId: player._id,
            launchToken: player.launchToken,
            roundId: wagerId,//['bet',wagerId, idx].join('_'),
            amount: bet,
            roundEnded: true,
            deviceId: player.clientType,
            extTransactionId: '',
            gameType: bet > 0 ? 1 : 2,
            gameId: player.gameId,
            creditCode: player.currency,
            ggId: 1,
            dsUseDc: player.dsUseDc,
        };

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}-cost:${bet}
   --opts:${util.inspect(opts, false, 10)}
   billChecker._callBetAsync `);
        logger.warn('[billChecker][_callBetAsync][CallAPI] bet ：', opts);

        let betRes = yield utils.httpPost(url, opts);
        logger.warn('[billChecker][_callBetAsync][RES] playerId: %s, bet ：', player._id, JSON.stringify(betRes));

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}-cost:${bet}
   --betRes:${util.inspect(betRes, false, 10)}
   billChecker._callBetAsync return `);

        let debugInfo = this.hasDebug(wagerId, idx);
        if (!!debugInfo) {
            yield P.delay(debugInfo.timeout);

            betRes = null;
        }

        if (!!betRes && betRes.status == apiCode.SUCCESS) {
            if (!!betRes.data.status && betRes.data.status == apiCode.FAILED) {
                // api 回傳失敗
                return null
            } else {
                if (!!betRes.data.status) {
                    // 扣款失敗: 餘額不足
                    return {code: betRes.data.status, cost: bet, gain: 0, amount: betRes.data.creditAmount};
                }

                return {cost: bet, gain: 0, amount: betRes.data.creditAmount};
            }
        } else {
            return null
        }
    } catch (err) {
        return null
    }
})

/** gameType *************************
 * 1. 主遊戲  2. 免費遊戲  3. 獎勵遊戲
 *************************************/

proto._callWinAsync = P.coroutine(function* (gain, wagerId, idx, bet, isBonusGame) {

    try {
        let self = this;
        let player = self.player;
        let gameType = 1;

        if (bet == 0) gameType = isBonusGame == 1 ? 3 : 2; // 免費子彈: 有中bonus => 3, 沒中bonus => 2

        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.win,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            upid: player.upid,
            playerId: player._id,
            launchToken: player.launchToken,
            roundId: wagerId,//['win',wagerId, idx].join('_'),
            amount: gain,
            roundEnded: true,
            deviceId: player.clientType,
            extTransactionId: '',
            gameType: gameType,
            isJPWin: false,
            gameId: player.gameId,
            creditCode: player.currency,
            ggId: 1,
            dsUseDc: player.dsUseDc,
        };

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}-cost:${bet}-gain:${gain}
   --opts:${util.inspect(opts, false, 10)}
   billChecker._callWinAsync `);

        logger.info(`[billChecker][_callWinAsync][CallAPI] win ：`, opts);

        let winRes = yield utils.httpPost(url, opts);

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}-cost:${bet}-gain:${gain}
   --winRes:${util.inspect(winRes, false, 10)}
   billChecker._callWinAsync return `);

        logger.info(`[billChecker][_callWinAsync][RES] win ：`, winRes);

        let debugInfo = this.hasDebug(wagerId, idx);
        if (!!debugInfo) {
            yield P.delay(debugInfo.timeout);

            winRes = null;
        }

        if (!!winRes && winRes.status == apiCode.SUCCESS) {
            if (!!winRes.data.status && winRes.data.status == apiCode.FAILED) {
                return null
            } else {

                return {cost: bet, gain: gain, amount: winRes.data.creditAmount};
            }
        } else {
            return null
        }
    } catch (err) {
        return null
    }
});

proto._callBetThenWinAsync = P.coroutine(function* (bet, gain, wagerId, idx) {

    try {
        let self = this;
        let betRes = null;

        if (bet > 0) {
            betRes = yield self._callBetAsync(bet, wagerId, idx);

            if (!betRes) {
                return null;
            }
        }

        if (!betRes.code) { // bet 216，不送 win
            let winRes = yield self._callWinAsync(gain, wagerId, idx, bet, false);

            if (!!winRes) {
                winRes.wagerId = wagerId;
                winRes.idx = idx;
                winRes.betSucc = true;
                winRes.winSucc = true;

                return winRes;
            }
        }

        if (!!betRes) {
            betRes.wagerId = wagerId;
            betRes.idx = idx;

            if (!betRes.code) {
                betRes.betSucc = true;
                betRes.winSucc = gain == 0 ? true : false;
            } else {
                betRes.betSucc = false;
                betRes.winSucc = false;
            }
        }

        return betRes;
    } catch (err) {
        return null;
    }
});

proto._callFetchBalance = P.coroutine(function* (wagerId, idx) {
    try {
        let self = this;
        let player = self.player;
        let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let opts = {
            method: consts.APIMethod.fetchBalance,
            platform: consts.APIServerPlatform.api,
            dc: player.dc,
            // agentId:      session.get('agentId'),
            launchToken: player.launchToken,
            playerId: player._id,
            gameId: player.gameId,
            isSingleWallet: player.isSingleWallet,
            ggId: 1,
            dsUseDc: player.dsUseDc,
        };

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --wagerId:${wagerId}-idx:${idx}
   --opts:${util.inspect(opts, false, 10)}
   billChecker._callFetchBalance `);

        let apiData = yield utils.httpPost(url, opts);

        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
     --wagerId:${wagerId}-idx:${idx}
     --winRes:${util.inspect(apiData, false, 10)}
     billChecker._callFetchBalance return `);

        if (!!apiData && apiData.status == apiCode.SUCCESS) {
            if (!!apiData.data.status) {
                switch (apiData.data.status) {
                    case C.API_RETURN_TOKEN_EXPIRED: // token 過期
                    case C.CUSTOMER_IN_MAINTENANCE_MODE: // 介接方維護中
                        self.app.controllers.fishHunterPlayer.kickPlayer(player.connectorId, player._id, player.gameId, player.loginIp, player.updateTime, C.API_AUTH_FAIL);
                        break;
                    default:
                        logger.error('[billChecker][_callFetchBalance][RES] playerId: %s, fetchBalance API failed', player._id, JSON.stringify(apiData));
                        break;
                }
                return null;
            } else {
                return {amount: apiData.data.amount};
            }
        } else {
            return null;
        }
    } catch (err) {
        return null;
    }
});

proto._handleBillError = function (type, data, reason) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --billType:${type}-reason:${reason}
   --data:${util.inspect(data, false, 10)}
     billChecker._handleBillError `);

    const {wagerId, idx, betSucc, winSucc, cost, gain} = data;
    let frozenBillDao = this.app.controllers.daoMgr.getFrozenBillDao();

    return frozenBillDao.createAsync({
        createTime: utils.timeConvert(Date.now()),
        playerId: this.playerId,
        gameId: this.gameId,
        wagerId: wagerId,
        idx: idx,
        cost: cost || 0,
        gain: gain || 0,
        action: type,
        reason: reason,
        betSucc: betSucc,
        winSucc: winSucc
    })
}

proto._stopQuick = function (type, apiBalance) {
    logger.debug(`pId:${this.playerId}-gId:${this.gameId}
   --${type}Count:${this.bills[type].length}
   --billType:${type}-apiBalance:${apiBalance}
     billChecker._stopQuick `);

    let newCb = (err, data) => {
        logger.debug(`pId:${this.playerId}-gId:${this.gameId}
     --data:${util.inspect(data, false, 10)}
     --billType:${type}
     billChecker._stopQuick call return `);

        if (!!err) {
            this._handleBillError(type, data, 'stopQuick call ' + (err.message || ''));
        }

        return true;
    }

    let bills = this.bills[type];

    bills.forEach(v => {
        let {wId, idx, cost, gain, cb} = v;

        let data = {};
        data.wagerId = wId;
        data.idx = idx;
        data.cost = cost;
        data.gain = gain;
        data.betSucc = cost > 0 ? true : false;

        if (gain > 0) {
            data.winSucc = true;
            data.betSucc = true;
        } else {
            data.winSucc = gain == 0 ? data.betSucc : false;
        }

        cost = cost || 0;
        gain = gain || 0;
        apiBalance = utils.number.add(apiBalance, gain);
        apiBalance = utils.number.sub(apiBalance, cost);

        data.amount = apiBalance;

        cb && cb(null, data);

        v.cb = newCb;
    })

    let handler = {
        [consts.BillType.bet]: this._handleNextBet.bind(this),
        [consts.BillType.win]: this._handleNextWin.bind(this),
        [consts.BillType.betWin]: this._handleNextBetAndWin.bind(this),
        [consts.BillType.betThenWin]: this._handleNextBetThenWin.bind(this)
    }

    handler[type](type, true, null, '_stopQuick');
}


///////////////////////////////////////////////////////
//调试
//
const DEBUG_ENABLE = false;
proto.blockBillAndFail = function (wagerId, idx, timeout, matchIdx) {
    if (!DEBUG_ENABLE) {
        return;
    }

    this.debugBillInfo.push({wId: wagerId, idx, timeout, matchIdx})
}

proto.hasDebug = function (wagerId, idx) {
    if (!DEBUG_ENABLE) {
        return null;
    }

    let index = this.debugBillInfo.findIndex((v) => {
        if (v.matchIdx) {
            return (wagerId == v.wId && idx == v.idx);
        } else {
            return (wagerId == v.wId);
        }
    });

    if (index == -1) {
        return null;
    } else {
        let arr = this.debugBillInfo.splice(index, 1);

        logger.debug('hit debugInfo ', util.inspect(arr[0], false, 10));

        return arr[0];
    }
}

