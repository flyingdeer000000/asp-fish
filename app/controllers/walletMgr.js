/**
 * Created by GOGA on 2019/6/18.
 */
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('wallet', __filename);
let MultipleWallet = require('../domain/wallet/multipleWallet');
let CreditWallet = require('../domain/wallet/creditWallet');
let SingleWallet = require('../domain/wallet/singleWallet');
let CreditMergeWallet = require('../domain/wallet/creditMergeWallet');
let ClipSingleWallet = require('../domain/wallet/clipSingleWallet');
let ClipCreditWallet = require('../domain/wallet/clipCreditWallet');
let consts = require('../../share/consts');
let utils = require('../utils/utils');
const _ = require('lodash');

let Controller = function (app) {
    this.app = app;
    this.wallets = {};
    this.queues = {};
};

module.exports = function (app) {
    return new Controller(app);
};


let proto = Controller.prototype;
let cort = P.coroutine;

proto._key = function (playerId, gameId) {
    return [playerId, gameId].join('*');
}

// 调用 memoryWallet.flushAsync 时 remove 设为true
proto.getWalletAsync = async function (playerId, gameId, remove, wagerId, betSetting) {
    logger.debug(`getWalletAsync playerId:${playerId}, gameId:${gameId}`)
    let key = this._key(playerId, gameId);
    let self = this;

    let wallet = this.wallets[key];
    if (!wallet) {

        if (remove) {
            return P.resolve(null);
        }

        if (!self.queues[key]) {
            self.queues[key] = [];
        }

        let deferred = P.defer();
        self.queues[key].push(deferred);

        if (self.queues[key].length == 1) {
            P.resolve()
                .then(async () => {
                    if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                        betSetting = await this.app.controllers.player.getBetSetting(playerId);
                        if (!betSetting || typeof (betSetting) !== 'object' || !betSetting.info) {
                            return null;
                        }
                    }
                    return self._createWallet(playerId, gameId, betSetting);
                })
                .then(data => {
                    self.queues[key].forEach(defer => {
                        defer.resolve(data);
                    });
                    self.queues[key] = [];
                })
        }

        return deferred.promise;

    } else {
        logger.debug(`getWalletAsync memWallet playerId:${playerId}, gameId:${gameId}, amount: ${wallet.amount}, quota: ${wallet.quota}, remove: ${remove}
    wagerId:${wallet.wagerId}, params_wagerId: ${wagerId}
    areaId: ${wallet.areaId}, tableId: ${wallet.tableId}`);

        if (wallet.wagerId == '') {
            if (remove === false && !!wagerId) {
                // 入桌有傳 wagerId 就使用入桌時 tokens init 產生的
                this.wallets[key].wagerId = wallet.wagerId = wagerId; // 更新 memWallet 的 wagerId
            } else {
                let tokensDao = wallet.app.controllers.daoMgr.getGameTokenDao();
                let tokens = await tokensDao.findOneAsync(playerId, gameId, true);
                logger.debug('[walletMgr][getWalletAsync] 回傳前 playerId: %s, gameId: %s, tokens: %s', playerId, gameId, JSON.stringify(tokens));
                // 更新 memWallet 的 wagerId
                this.wallets[key].wagerId = wallet.wagerId = tokens.wagerId == '' ? utils.getWId(playerId, gameId) : tokens.wagerId;
            }
        } else if (!!wagerId && wallet.wagerId !== wagerId) {
            // 狀況: 離桌失敗，memWallet 未清除上一場資訊時，重新入桌時以 tokens.wagerId 為主，更新 memWallet 的 wagerId
            this.wallets[key].wagerId = wallet.wagerId = wagerId;
        }

        if (remove) {
            delete this.wallets[key];
            delete this.queues[key];
        }

        logger.debug(`getWalletAsync memWallet 回傳 playerId:${playerId}, gameId:${gameId}, amount: ${wallet.amount}, quota: ${wallet.quota}, remove: ${remove}
    wagerId:${wallet.wagerId}, params_wagerId: ${wagerId}
    areaId: ${wallet.areaId}, tableId: ${wallet.tableId}`);
        return P.resolve(wallet);
    }
}

proto.singleWalletBalanceSync = async function (key) {
    let self = this;
    let keys = [];

    if (!!key) {
        keys = [key];
    } else {
        keys = Object.keys(this.wallets);
    }

    let onlinePlayers = [];
    if (keys.length > 0) {
        onlinePlayers = await self.app.controllers.player.getSessionOnlinePlayers();
    }

    for (let memWallet_key of keys) {
        let wallet = this.wallets[memWallet_key];
        if (!wallet) continue;
        if (!!wallet.walletType && wallet.walletType != consts.walletType.multipleWallet) {
            // 後扣型錢包 && 玩家不在線上
            if (wallet.walletType == consts.walletType.singleBetAndWinDelay && onlinePlayers.indexOf(wallet.playerId) == -1) {
                // if (wallet.doAreaSummaryFlag == consts.WalletState.init && wallet.do_count >= 20) {
                //   // 進來超過 20 次還未結帳完，可能卡單(原因尚未查明) // 暫時刪除，否則玩家無法登入遊戲
                //   delete this.wallets[memWallet_key]; // 刪除 memWallet
                //   delete this.queues[memWallet_key];
                //   continue;
                // }
                this.wallets[memWallet_key].do_count++;
                // (玩家結帳完 || 進來超過 20 次還未結帳完) && 尚未執行結帳流程(doAreaSummary_forSingleDelay)
                if ((Object.keys(wallet.buffers).length == 0 || wallet.do_count >= 20) && wallet.doAreaSummaryFlag == consts.WalletState.init) {

                    logger.info(`[walletMgr][singleWalletBalanceSync]
          playerId: ${wallet.playerId}, statCost: ${wallet.statCost}, statGain: ${wallet.statGain}, frozenCost: ${wallet.frozenCost}, frozenGain: ${wallet.frozenGain}
          cost: ${wallet.cost}, gain: ${wallet.gain}, doAreaSummaryFlag: ${wallet.doAreaSummaryFlag}, serverId: ${wallet.app.getServerId()}, timerId: ${!!wallet.timerId}
          online: ${onlinePlayers.indexOf(wallet.playerId)}, do_count: ${wallet.do_count}, buffers: `, wallet.buffers);

                    this.wallets[memWallet_key].doAreaSummaryFlag = consts.WalletState.settling; // 防止進來第二次
                    let player = wallet.billChecker.player;
                    let doAreaSummaryRes = await wallet.app.controllers.standUp.doAreaSummary_forSingleDelay(player, player.tableId, player.connectorId, wallet.app.getServerId(), wallet.app.betSetting);
                    if (this.wallets[memWallet_key]) this.wallets[memWallet_key].doAreaSummaryFlag = consts.WalletState.settled; // 設為完成登入時才能將 memWallet 刪除
                    logger.info('[walletMgr][singleWalletBalanceSync] playerId: %s, doAreaSummaryRes: ', wallet.playerId, doAreaSummaryRes);
                    delete this.wallets[memWallet_key]; // 刪除 memWallet
                    delete this.queues[memWallet_key];
                }
                continue;
            }

            wallet.fetchBalance((err, data) => {
                if (!err && data.update) {
                    let pushData = {
                        pid: data.playerId,
                        balance: wallet.getRealTokens()
                    };
                    self.app.controllers.table.pushAsync(wallet.tableId, null, consts.route.client.game.UPDATE_BALANCE, pushData, false);
                }
            })
        } else {
            // 多錢包: 判斷玩家若已登出則刪除 memWallet // 殘留原因: stopFire 處理失敗，未做 remove
            if (onlinePlayers.indexOf(wallet.playerId) == -1) delete this.wallets[memWallet_key];
        }
    }
}

proto.checkGameSettlementDone = async function (playerId, gameId, reason) {
    let key = this._key(playerId, gameId);
    let wallet = this.wallets[key];
    if (!wallet) return true;
    logger.info(`[walletMgr][checkGameSettlementDone] playerId: ${wallet.playerId}, doAreaSummaryFlag: ${wallet.doAreaSummaryFlag}, reason: ${reason}, wallet.buffers:`, wallet.buffers);

    // 玩家上一場未結帳完成
    if (Object.keys(wallet.buffers).length > 0) return false;

    switch (reason) {
        case consts.route.client.clientAction.twLogin: // 登入
            // 檢查玩家上一場是否結帳完成
            if (wallet.doAreaSummaryFlag !== consts.WalletState.settled) return false;
            delete this.wallets[key]; // 刪除 memWallet
            return true; // 玩家結帳完成
        case consts.route.client.clientAction.quitGame: // 回遊戲大廳的離桌
            return true;
    }
}

proto._createWallet = function (playerId, gameId, betSetting) {
    let self = this;
    let wallet = null;
    let key = this._key(playerId, gameId);

    return P.resolve()
        .then(() => {
            let playerDao = self.app.controllers.daoMgr.getPlayerDao();

            return playerDao.findByIdAsync(playerId, true);
        })
        .then(async (data) => {
            if (!data) {
                return P.reject('no GameToken found');
            } else {
                let maxFrozenCost;
                let gameConfig = self.app.controllers.fishHunterConfig.getGameConfig(gameId, data.tableLevel);
                // let currencyConf = self.app.controllers.fishHunterConfig.getCurrencyConfig();
                // let costList = currencyConf[(data.currency)].cannon.cost[data.tableLevel];
                self.app['betSetting'] = betSetting; // 各錢包 cache 加入 betSetting
                // player加入域名設定使用的dc
                let dsUseDc;
                const session = await self.app.controllers.player.getSession(playerId);
                if (session) dsUseDc = (session.get('domainSetting')) ? session.get('domainSetting').useDc : undefined;
                data['dsUseDc'] = dsUseDc || data.dc;
                let costList = betSetting.info.levels[data.tableLevel].cannon.cost;
                switch (data.isSingleWallet) {
                    case consts.walletType.multipleWallet:
                        wallet = new MultipleWallet(self.app, playerId, gameId, data.tableId, data);
                        break
                    case consts.walletType.singleWallet:
                        maxFrozenCost = utils.number.multiply(costList[costList.length - 1], gameConfig.cannon.maxBullets, 5);
                        wallet = new SingleWallet(self.app, playerId, gameId, data.tableId, data, maxFrozenCost);
                        break
                    case consts.walletType.singleBetAndWin:
                        maxFrozenCost = utils.number.multiply(costList[costList.length - 1], gameConfig.cannon.maxBullets, 5);
                        wallet = new CreditWallet(self.app, playerId, gameId, data.tableId, data, maxFrozenCost);
                        break
                    case consts.walletType.singleBetAndWinDelay:
                        maxFrozenCost = utils.number.multiply(costList[costList.length - 1], gameConfig.cannon.maxBullets, 5);
                        wallet = new CreditMergeWallet(self.app, playerId, gameId, data.tableId, data, maxFrozenCost);
                        break
                    default: {
                        let clipAmount = 0;
                        let reloadAmount = 0;

                        if (typeof data.isSingleWallet.reload == 'undefined') {
                            // 彈夾額度 clip 為該遊戲房中最大投注值的 reloadMultiple 倍
                            clipAmount = utils.number.multiply(costList[costList.length - 1], data.isSingleWallet.reloadMultiple);
                            reloadAmount = utils.number.multiply(costList[costList.length - 1], 2);
                        } else {
                            //FIX
                            if (_.isNumber(data.isSingleWallet.clip)) {
                                clipAmount = _.toNumber(data.isSingleWallet.clip);
                            } else {
                                clipAmount = _.toNumber(data.isSingleWallet.clip.split('-')[1]);
                            }
                            reloadAmount = data.isSingleWallet.reload
                        }

                        if (data.isSingleWallet.clip == 'AUTO' || _.isNumber(data.isSingleWallet.clip))
                            wallet = new ClipSingleWallet(self.app, playerId, gameId, data.tableId, data, clipAmount, reloadAmount);
                        else
                            wallet = new ClipCreditWallet(self.app, playerId, gameId, data.tableId, data, clipAmount, reloadAmount);

                        return wallet;
                    }
                }
            }
        })
        .then(() => {
            return wallet.initAsync();
        })
        .then(data => {
            if (!!data) {
                self.wallets[key] = wallet;
                self.wallets[key]['doAreaSummaryFlag'] = consts.WalletState.init; // 用來判斷是否在執行結帳中
                self.wallets[key]['do_count'] = 1; // 用來判斷玩家已斷線，執行了幾次

                return wallet;
            } else {
                return null;
            }
        })
        .catch(err => {
            logger.error(`${playerId}-${gameId} getWallet error `, err);

            return null;
        })
}
