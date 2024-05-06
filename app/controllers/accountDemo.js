'use strict';
let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);
let C = require('../../share/constant');
let utils = require('../utils/utils');
let consts = require('../../share/consts');
const apiCode = require('../expressRouter/apiServerStatus');
const Mona = require("../dao/mona");

const DEMO_ACCOUNT_NAME = "DEMO_";
const DEMO_ACCOUNT_NUM = 999999;

let Controller = function (app) {
    this.app = app;
    this.mona = new Mona({
        shardId: app.getServerId()
    });
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;


function randomPlayerId() {
    const minNumber = 1;
    const randomNumber = Math.floor(
        Math.random() * (DEMO_ACCOUNT_NUM - minNumber + 1) + minNumber
    );
    const formattedNumber = randomNumber.toString().padStart(5, '0');
    return `${DEMO_ACCOUNT_NAME}${formattedNumber}`;
}

proto.getOneFreeDemoAccount = async function (opts, playerId) {

    let self = this;

    let config = self.app.controllers.fishHunterConfig.getFishServerConfig();

    let betSetting = {
        usedCid: 'DEMO',
        maxReward: 50000,
        exchangeLimit: 100000,
        info: {
            levels: {
                '1': {
                    minRequest: 0,
                    cannon: {
                        cost: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
                        level: [0.1, 1, 5]
                    }
                },
                '2': {
                    minRequest: 1000,
                    cannon: {
                        cost: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
                        level: [1, 10, 50]
                    }
                },
                '3': {
                    minRequest: 5000,
                    cannon: {
                        cost: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 250, 300, 350, 400, 450, 500],
                        level: [10, 100, 400]
                    }
                }
            }
        },
        exchangeRate: 1
    };

    let demoAccId = playerId || "";

    const ret = {
        status: apiCode.SUCCESS,
        data: {
            playerId: demoAccId,
            userName: demoAccId,
            nickName: demoAccId,
            avatarUrl: '',
            clientType: opts.clientType || "",
            creditCode: 'CNY',
            creditAmount: 100000,
            accountState: 'N',
            HallId: '131',
            UpId: '132',
            dc: 'IG88',
            isPromo: 0,
            os: opts.os || "",
            balance: 0,
            isSingleWallet: consts.walletType.multipleWallet,
            token: config['IG_Auth'] ? config['IG_Auth'].token : "",
            MySQLWallet: true,
            // creditSymbol: '¥',
            lobbyBalance: true,
            showClock: true,
            showHelp: true,
            oneClickHelp: true,
            isDemo: 2,
            roundID: Date.now(),
            betSetting,
            domainSetting: {useDc: 'MOCK'}
        }
    };

    if (demoAccId) {
        return ret;
    }

    let player;
    let demoAccLength = DEMO_ACCOUNT_NUM.toString().length;
    for (let i = 0; i < DEMO_ACCOUNT_NUM; i++) {
        demoAccId = randomPlayerId();
        // demoAccId = DEMO_ACCOUNT_NAME + (Array(demoAccLength).join("0") + i).slice(-demoAccLength);
        // demo 用 demoAcc 來當 playerId
        // player = await self.app.controllers.fishHunterPlayer.findReadOnlyAsync(demoAcc);
        player = await this.mona.get({
            schema: this.app.models['FishHunterPlayer'],
            id: demoAccId,
        });

        console.log("[account] testing", demoAccId);

        if (!player || (player && !player.connectorId)) {
            ret.data.playerId = demoAccId;
            ret.data.userName = demoAccId;
            ret.data.nickName = demoAccId;
            console.log('[account] ret', ret);
            return ret;
        }
    }

    return ret;

}

proto.getOnecallFetchBalanceRes = function () {
    return {
        status: apiCode.SUCCESS,
        data: {
            amount: 0,
        }
    };
}

proto.getOneTransferInRes = function (opts) {
    try {
        return {
            status: apiCode.SUCCESS,
            data:
                {
                    state: apiCode.SUCCESS,
                    token: opts.launchToken,
                    balance: opts.amount,
                    transactionId: ''
                }
        };
    } catch (err) {
        logger.error('[accountDemo][getOneTransferInRes][catch] err: ', err);
        throw err;
    }
}

proto.getOneModifyCreditByPlayerIdRes = async function (opts) {
    try {
        let self = this;
        let res = null;
        let player = await self.app.controllers.fishHunterPlayer.findReadOnlyAsync(opts.playerId);
        if (player) {
            res = {
                error: null,
                data: {
                    userName: player.userName,
                    creditCode: player.currency,
                    creditAmount: utils.number.add(opts.quota, opts.amount),
                    balance_before: opts.quota,
                    balance_after: utils.number.add(opts.quota, opts.amount),
                    amount: opts.amount,
                    logQuotaId: 0,
                }
            }
        }
        return res;
    } catch (err) {
        logger.error('[accountDemo][getOneModifyCreditByPlayerIdRes][catch] err: ', err);
        throw err;
    }
}

proto.getOneTransferOutRes = function (opts) {
    try {
        return {
            status: apiCode.SUCCESS,
            data:
                {
                    state: apiCode.SUCCESS,
                    token: opts.launchToken,
                    transactionId: ""
                }
        };
    } catch (err) {
        logger.error('[accountDemo][getOneTransferOutRes][catch] err: ', err);
        throw err;
    }
}

proto.getOneCallKeepAliveRes = function () {
    try {
        return {
            status: apiCode.SUCCESS,
            data:
                {
                    amount: 0,
                }
        };
    } catch (err) {
        logger.error('[accountDemo][getOneCallKeepAliveRes][catch] err: ', err);
        throw err;
    }
}
