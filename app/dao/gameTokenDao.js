/**
 * Created by GOGA on 2019/6/18.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('wallet', __filename);
const uuid = require('uuid/v1');
let util = require('util');
let utils = require('../utils/utils');
let consts = require('../../share/consts');
let _ = require('lodash');

module.exports = memdbDao = function (app) {
    this.app = app;
    this.name = 'GameTokensDao'
}

let proto = memdbDao.prototype;
let cort = P.coroutine;


// 單場開始前呼叫
proto.initAsync = function (playerId, gameId, walletType, creditCode, quota, gameTypeId, shardId) {
    logger.debug('dao.initAsync ', util.inspect({playerId, gameId, walletType, creditCode, quota}, false, 10));
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};
        let rec = yield modelGameTokens.findOneAsync(opts);
        let now = Date.now();
        let nowStr = utils.timeConvert(now, true);

        if (!rec) {
            rec = new modelGameTokens(opts);
            if (playerId && gameId && creditCode) {
                rec._id = playerId + '#' + gameId + '#' + (creditCode || '');
            } else {
                rec._id = uuid();
            }
            rec.walletType = walletType || consts.walletType.multipleWallet;
            rec.creditCode = creditCode || '';
            rec.createTime = rec.updateTime = nowStr;
            if (!!gameTypeId) rec.gameTypeId = gameTypeId;
        } else {
            if (rec.state != consts.WalletState.init && rec.state != consts.WalletState.settled) {
                logger.warn('initAsync wallet state exception ', rec.toJSON()); // 表示上次登入時，有 call API (ex.betAndWin) 失敗

                rec.initVars();
            }

            rec.state = consts.WalletState.init;
            rec.walletType = walletType || consts.walletType.multipleWallet;
            rec.creditCode = creditCode || rec.creditCode;
            rec.updateTime = nowStr;
            if (!!gameTypeId) rec.gameTypeId = gameTypeId;
        }
        rec.wagerId = utils.getWId(playerId, gameId);
        rec.lastFireTime = Date.now();

        if (_.isNumber(quota)) {
            rec.quota = quota;

            //普通单钱包，同步平台余额 // 單錢包(bet+win) & 單錢包(betAndWin) & 後扣型單錢包
            if (rec.normalSingleWallet) {
                rec.amount = quota;
            }

            if (rec.walletType != consts.walletType.multipleWallet) {
                rec.oneAreaExchange = quota;
            }
        }

        if (rec.walletType == consts.walletType.multipleWallet && rec.allAreaExchange > 0) {
            // 多錢包 && 二次入桌
            rec.oneAreaExchange = rec.amount;
        }
        rec.markModified('walletType');
        yield rec.saveAsync();
        return rec;

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.initAsync `, err);
            return null;
        })
}

// 餘額：兌換總額+贏分-押注
proto.getBalanceAsync = function (playerId, gameId, shardId) {
    logger.debug('dao.getBalanceAsync ', util.inspect({playerId, gameId}, false, 10));

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};
        let rec = yield modelGameTokens.findOneReadOnlyAsync(opts);

        if (!!rec) {
            let num = 0;

            if (rec.walletType != consts.walletType.multipleWallet) {
                num = utils.number.add(rec.amount, rec.gain);
                num = utils.number.sub(num, rec.cost);
            } else {
                //非多钱包，直接返回平台余额
                num = rec.amount;
            }

            return num;
        } else {
            return 0;
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.getBalanceAsync `, err);
            return null;
        })
}

// 兌換時呼叫
proto.exchangeAsync = function (player, cash, ratio, quota, creditCode, shardId) {
    let playerId = player._id;
    let gameId = player.gameId;
    logger.info('dao.exchangeAsync ', util.inspect({playerId, gameId, cash, ratio, quota, creditCode}, false, 10));

    let app = this.app;
    cash = Math.abs(cash);

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};
        let rec = yield modelGameTokens.findOneAsync(opts);

        if (!rec) {
            logger.error(`${this.name}.exchangeAsync no wallet `, opts, ' data ', {
                playerId,
                gameId,
                cash,
                ratio,
                creditCode
            });
            return null;
        } else {
            // 錢包狀態非init時, 增加判斷沒有轉過任何帳時, 才跳錯 // 發生狀況: 玩家玩到沒錢離桌 amount=0, 再入桌要轉帳時錢包狀態為: settled, 此處會有錯
            if ((rec.state != consts.WalletState.init && rec.allAreaExchange == 0) || rec.creditCode != creditCode) {
                // 檢查玩家是否在線上，來決定是否為可預期錯誤。發生原因: forceExchange=true時，玩家同時登出，導致狀態為 settled 也尚未轉帳過 allAreaExchange=0
                let sessionId = yield app.controllers.fishHunterPlayer.getPlayerSessionId(player, 'gameTokenDao.exchangeAsync');
                if (!sessionId) {
                    logger.warn(`${this.name}.exchangeAsync wallet error `, rec.toJSON(), ' data ', {
                        playerId,
                        gameId,
                        cash,
                        ratio,
                        creditCode,
                        sessionId
                    });
                } else {
                    logger.error(`${this.name}.exchangeAsync wallet error `, rec.toJSON(), ' data ', {
                        playerId,
                        gameId,
                        cash,
                        ratio,
                        creditCode,
                        sessionId
                    });
                }
                return null;
            }

            //非多钱包，不支持转账
            if (rec.walletType != consts.walletType.multipleWallet) {
                logger.error(`${this.name}.exchangeAsync walletType error `, rec.toJSON(), ' data ', {
                    playerId,
                    gameId,
                    cash,
                    ratio,
                    creditCode
                });

                return null;
            }

            let now = Date.now();
            let nowStr = utils.timeConvert(now, true);

            rec.updateTime = nowStr;

            rec.amount = utils.number.add(rec.amount, cash); // ex. 30000 + (-20000)
            rec.ratio = ratio;
            rec.oneAreaExchange = utils.number.add(rec.oneAreaExchange, cash);
            rec.allAreaExchange = utils.number.add(rec.allAreaExchange, cash);
            rec.quota = quota;
        }

        yield rec.saveAsync();
        return rec;
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.exchangeAsync `, err);
            return null;
        })
}

// 自動調用
proto.saveMemWalletAsync = function (playerId, gameId, amount, gain, cost, lastIndex, frozenCost, frozenGain, wagerId, quota, lastFireTime, shardId) {
    logger.info('dao.saveMemWalletAsync ', util.inspect({
        playerId,
        gameId,
        amount,
        gain,
        cost,
        lastIndex,
        frozenCost,
        frozenGain,
        wagerId,
        quota,
        lastFireTime
    }, false, 10));
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};
        let rec = yield modelGameTokens.findOneAsync(opts);

        if (!rec) {
            logger.error(`${this.name}.saveMemWalletAsync no wallet `, opts, ' data ', {
                amount,
                gain,
                cost,
                lastIndex,
                wagerId,
                quota,
                lastFireTime
            });
            return null;
        } else {
            if (rec.walletType != consts.walletType.multipleWallet) {
                //非多钱包，更新平台余额
                rec.amount = amount;
            } else {
                if (rec.amount != amount) {
                    logger.warn(`${this.name}.saveMemWalletAsync wallet error `, rec.toJSON(), ' data ', {
                        playerId,
                        gameId,
                        amount,
                        gain,
                        cost,
                        lastIndex,
                        wagerId,
                        quota,
                        lastFireTime
                    });

                    return null;
                }
            }

            let now = Date.now();
            let nowStr = utils.timeConvert(now, true);

            rec.updateTime = nowStr;

            rec.gain = gain;
            rec.cost = cost;
            rec.lastIndex = lastIndex;

            rec.frozenCost = frozenCost;
            rec.frozenGain = frozenGain;

            rec.wagerId = wagerId;
            rec.quota = quota;

            rec.lastFireTime = lastFireTime;

            logger.info(`dao.saveMemWalletAsync success. playerId: ${playerId}, tokens: ${JSON.stringify(rec)}`);

            return rec.saveAsync();
        }

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.saveMemWalletAsync `, err);
            return null;
        })
}

// 取週期內產生的子單
proto.getSubReportAsync = function (playerId, gameId, shardId) {
    logger.debug('dao.getSubReportAsync ', util.inspect({playerId, gameId}, false, 10));

    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};
        let rec = yield modelGameTokens.findOneReadOnlyAsync(opts);

        if (!!rec) {
            let bet = utils.number.sub(rec.cost, rec.betGold);
            let win = utils.number.sub(rec.gain, rec.winGold);
            let beginIdx = rec.currIndex + 1;
            let endIdx = rec.lastIndex;
            let wagerId = rec.wagerId;

            return {wagerId, beginIdx, endIdx, bet, win};
        } else {
            return null;
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.getSubReportAsync `, err);
            return null;
        })
}

// 執行後將子彈結果存入BetGold, WinGold
proto.doSubReportDone = function (playerId, gameId, wagerId, beginIdx, endIdx, bet, win, shardId) {
    logger.debug('dao.doSubReportDone ', util.inspect({
        playerId,
        gameId,
        wagerId,
        beginIdx,
        endIdx,
        bet,
        win
    }, false, 10));
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};

        let rec = yield modelGameTokens.findOneAsync(opts);

        if (!rec) {
            logger.error(`${this.name}.doSubReportDone no wallet `, opts, ' data ', {
                wagerId,
                beginIdx,
                endIdx,
                bet,
                win
            });
            return null;
        } else {
            // if( rec.currIndex != beginIdx -1 || rec.wagerId != wagerId) {
            //   logger.error(`${this.name}.doSubReportDone wallet error `, rec.toJSON(),' data ', {playerId, gameId, wagerId, beginIdx, endIdx, bet, win});
            //
            //   return null;
            // }
            let now = Date.now();
            let nowStr = utils.timeConvert(now, true);

            rec.updateTime = nowStr;

            rec.currIndex = endIdx;
            rec.betGold = utils.number.add(rec.betGold, bet);
            rec.winGold = utils.number.add(rec.winGold, win);

            yield rec.saveAsync();

            return rec;
        }

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.doSubReportDone `, err);
            return null;
        })
}

// 單場離開準備結算（離桌呼叫stopFire前呼叫，會擋掉bet跟win）
proto.settlePrepare = function (playerId, gameId, shardId) {
    logger.debug('dao.settlePrepare ', util.inspect({playerId, gameId}, false, 10));
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};

        let rec = yield modelGameTokens.findOneAsync(opts);

        if (!rec) {
            logger.error(`${this.name}.settlePrepare no wallet `, opts);
            return null;
        } else {
            if (rec.state != consts.WalletState.init && rec.state != consts.WalletState.settled) {
                return rec;
            } else {
                let now = Date.now();
                let nowStr = utils.timeConvert(now, true);

                rec.updateTime = nowStr;
                rec.state = consts.WalletState.settling;

                yield rec.saveAsync();
                return rec;
            }
        }

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.settlePrepare `, err);
            return null;
        })
}

// 單場離開完成結算
proto.settleComplete = function (playerId, gameId, isLogout, offline, shardId) {
    logger.debug('dao.settleComplete ', util.inspect({playerId, gameId, offline}, false, 10));
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};

        let rec = yield modelGameTokens.findOneAsync(opts);
        if (!rec) {
            logger.error(`${this.name}.settleComplete no wallet `, opts);
            return null;
        } else {
            if ((rec.walletType == consts.walletType.multipleWallet && !offline && rec.state != consts.WalletState.settling) ||
                (rec.walletType !== consts.walletType.multipleWallet && rec.state != consts.WalletState.settling)
            ) {
                // 多錢包 offline = true (transferOut) 不檢查錢包狀態，強制初始化
                // 其他類型錢包都要檢查錢包狀態
                logger.warn('dao.settleComplete state expect settling ', util.inspect({
                    playerId,
                    gameId,
                    offline,
                    state: rec.state
                }, false, 10))
                return rec;
            } else {
                let now = Date.now();
                let nowStr = utils.timeConvert(now, true);

                if (rec.frozenCost != 0 || rec.frozenGain != 0) {
                    logger.warn('dao.settleComplete frozen ', util.inspect({
                        playerId,
                        gameId,
                        offline,
                        frozenCost: rec.frozenCost,
                        frozenGain: rec.frozenGain
                    }, false, 10))
                    return rec;
                }

                rec.updateTime = nowStr;
                if (rec.walletType == consts.walletType.multipleWallet) {
                    // 多錢包
                    if (!isLogout || offline) {
                        // 玩家回大廳(!isLogout) 或者 walletToAccountAsync 呼叫此方法(offline)
                        // 錢包狀態設為[結帳完成]
                        rec.state = consts.WalletState.settled;
                    }
                } else {
                    rec.state = consts.WalletState.settled;
                }

                rec.oneAreaExchange = 0;
                rec.currIndex = 0;
                rec.lastIndex = 0;
                rec.wagerId = '';

                // 玩家登出 // 錢包下注初始化
                if (offline) {
                    rec.allAreaExchange = 0;
                    rec.ratio = 1;
                    rec.betGold = 0;
                    rec.winGold = 0;
                    rec.cost = 0;
                    rec.gain = 0;
                    rec.netWin = 0;

                    if (rec.walletType !== consts.walletType.singleBetAndWinDelay) {
                        // 後扣錢包不初始化錢包餘額，否則會導致未登出，入桌下一場餘額會變 0
                        rec.amount = 0;
                        rec.quota = 0;
                    }
                }
                // 玩家回到大廳 // 單場總結
                else {
                    let temp = utils.number.sub(rec.gain, rec.cost);
                    rec.netWin = utils.number.add(rec.netWin, temp);

                    // 多钱包非离线则更新余额，输赢归零
                    if (rec.walletType == consts.walletType.multipleWallet) {
                        rec.amount = rec.balance;
                        // 多錢包累加
                        rec.betGold = utils.number.add(rec.betGold, rec.cost);
                        rec.winGold = utils.number.add(rec.winGold, rec.gain);
                    } else {
                        rec.betGold = 0;
                        rec.winGold = 0;
                    }

                    rec.cost = 0;
                    rec.gain = 0;
                }
                logger.info(`[gameTokenDao][settleComplete] playerId: ${playerId}, gameId: ${gameId}, state: ${rec.state}, tokens:`, rec);

                yield rec.saveAsync();
                return rec;
            }
        }

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.settleComplete `, err);
            return null;
        })
}

proto.findOneAsync = function (playerId, gameId, readOnly, shardId) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};

        if (readOnly) {
            return modelGameTokens.findOneReadOnlyAsync(opts);
        } else {
            return modelGameTokens.findOneAsync(opts);
        }
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.findOneAsync `, err);
            return null;
        })
}

proto.createsync = function (playerId, gameId, opts, shardId) {
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let now = Date.now();
        let nowStr = utils.timeConvert(now, true);
        let data = {playerId, gameId, createTime: nowStr, updateTime: nowStr};

        let rec = new modelGameTokens(data)
        if (!rec._id) {
            if (playerId && gameId) {
                rec._id = playerId + '#' + gameId;
            } else {
                rec._id = uuid();
            }
        }
        return rec.saveAsync();
    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.createsync `, err);
            return null;
        })
}

// 單場開始前呼叫
proto.updateQuotaAsync = function (playerId, gameId, quota, shardId) {
    logger.debug('dao.updateQuotaAsync ', util.inspect({playerId, gameId, quota}, false, 10));
    let app = this.app;

    return app.memdb.goose.transactionAsync(cort(function* () {
        let modelGameTokens = app.models.GameTokens;
        let opts = {playerId, gameId};
        let rec = yield modelGameTokens.findOneAsync(opts);
        let now = Date.now();
        let nowStr = utils.timeConvert(now, true);

        if (!_.isNumber(quota)) {
            return null;
        }

        if (!rec) {
            return null;
        } else {
            if (rec.state != consts.WalletState.init && rec.state != consts.WalletState.settled) {
                // logger.warn('updateQuotaAsync wallet state exception ', rec.toJSON());

                return null;
            }
        }

        rec.quota = quota;

        //普通单钱包，同步平台余额
        if (rec.normalSingleWallet) {
            rec.amount = quota;
        }

        yield rec.saveAsync();
        return rec;

    }), shardId || app.getServerId())
        .catch(err => {
            logger.error(`${this.name}.updateQuotaAsync `, err);
            return null;
        })
}

// 恢复初始状态
proto.resetAsync = cort(function* (player, shardId, betSetting) {
    try {
        let self = this;

        let tokens = yield self.app.memdb.goose.transactionAsync(function () {
            return self.app.models.GameTokens.findOneReadOnlyAsync({playerId: player._id, gameId: player.gameId});
        }, shardId || self.app.getServerId());

        let creditAmount = null;

        if (!!tokens) {
            switch (player.isSingleWallet) {
                case consts.walletType.singleWallet: // 單錢包(bet+Win) // 碰撞才會成立一對 bet+win // 不需退款
                case consts.walletType.singleBetAndWin: // 單錢包(betAndWin) // 碰撞才會送 betAndWin // 不需退款
                case consts.walletType.singleBetAndWinDelay: // 後扣型 // 不需退款
                default: // 彈夾型單錢包
                    // TODO: bet+win call win 返還
                    // TODO: betAndWin call betAndWin 返還
                    break;
                case consts.walletType.multipleWallet: // 多錢包
                    if (tokens.amount > 0) {
                        let res = yield self.app.controllers.fishHunterPlayer.walletToAccountAsync(player, 'gameTokenDao.resetAsync', betSetting);
                        creditAmount = res.creditAmount;
                    }
                    break;
            }
        } else {
            logger.error('[gameTokenDao][resetAsync] playerId: %s, tokens not found: ', player._id, tokens);
        }
        return creditAmount;
    } catch (err) {
        logger.error('[gameTokenDao][resetAsync] playerId: %s, catch err: ', player._id, err);
        return null;
    }
});
