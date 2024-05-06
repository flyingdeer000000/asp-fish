'use strict';

let utils = require('../utils/utils');
let consts = require('../../share/consts');

module.exports = function (app) {
    let mdbgoose = app.memdb.goose;

    let gameTokensSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: String, default: 0},
        updateTime: {type: String, default: 0},
        playerId: {type: String, default: ''},
        gameId: {type: String, default: ''},
        walletType: {type: mdbgoose.Schema.Types.Mixed, default: 0},
        creditCode: {type: String, default: 'CNY'},

        amount: {type: Number, default: 0},           // 多钱包-累計兌換， 单钱包-平台余额
        ratio: {type: Number, default: 1},

        oneAreaExchange: {type: Number, default: 0},
        allAreaExchange: {type: Number, default: 0},
        netWin: {type: Number, default: 0},          //单场总输赢
        quota: {type: Number, default: 0},           //平台余额，客户端显示用

        betGold: {type: Number, default: 0},        // 後扣型錢包: 累计提交到平台的下注总额，调用 doSubReportDone 更新 // 多錢包: settleComplete(,false) 做累加, 下次登入 settleComplete(,true) 會初始化
        winGold: {type: Number, default: 0},        // 後扣型錢包: 累计提交到平台的收益总额，调用 doSubReportDone 更新 // 多錢包: settleComplete(,false) 做累加, 下次登入 settleComplete(,true) 會初始化

        cost: {type: Number, default: 0},           //单场累计下注总额
        gain: {type: Number, default: 0},           //单场累计收益总额

        frozenCost: {type: Number, default: 0},     //平台异步结算时，本地累计未结算下注总额
        frozenGain: {type: Number, default: 0},     //平台异步结算时，本地累计未结算收益总额

        wagerId: {type: String, default: ''},
        lastIndex: {type: Number, default: 0},
        currIndex: {type: Number, default: 0},
        state: {type: String, default: 'init'},
        gameTypeId: {type: Number, default: 0},

        lastFireTime: {type: Number, default: 0}
    }, {collection: 'game_tokens'});

    gameTokensSchema.virtual('normalSingleWallet').get(function () {
        let walletType = this.walletType;

        let normalSingleWallet = (walletType == consts.walletType.singleWallet ||
            walletType == consts.walletType.singleBetAndWinDelay ||
            walletType == consts.walletType.singleBetAndWin
        )

        return normalSingleWallet;
    });

    gameTokensSchema.virtual('realNetWin').get(function () {
        let num = utils.number.sub(this.gain, this.cost);

        return utils.number.add(num, this.netWin);
    });

    gameTokensSchema.virtual('balance').get(function () {
        let num = 0;

        if (this.walletType == consts.walletType.multipleWallet) {
            num = utils.number.add(this.amount, this.gain);
            num = utils.number.sub(num, this.cost);
        } else {
            if (this.normalSingleWallet) {
                num = this.amount;
            } else {
                if (this.amount == 0) {
                    num = this.quota;
                } else {
                    num = utils.number.add(this.amount, this.gain);
                    num = utils.number.sub(num, this.cost);
                    num = utils.number.add(num, this.quota);
                }
            }
        }

        return num;
    });

    gameTokensSchema.virtual('tokenAmount').get(function () {
        let balance = this.balance;

        return utils.number.workDivide(balance, this.ratio);
    });

    //计算当前收益，后扣型行钱包定时需要小计一次
    gameTokensSchema.virtual('subtotalGain').get(function () {
        if (this.walletType == consts.walletType.singleBetAndWinDelay) {
            return utils.number.sub(this.gain, this.winGold);
        } else {
            return this.gain;
        }
    });

    //计算当前下注，后扣型行钱包定时需要小计一次
    gameTokensSchema.virtual('subtotalCost').get(function () {
        if (this.walletType == consts.walletType.singleBetAndWinDelay) {
            return utils.number.sub(this.cost, this.betGold);
            ;
        } else {
            return this.cost;
        }
    });

    gameTokensSchema.methods.initVars = function () {
        this.oneAreaExchange = 0;
        this.allAreaExchange = 0;
        this.ratio = 1;
        this.amount = 0;
        this.netWin = 0;
        this.quota = 0;
        this.betGold = 0;
        this.winGold = 0;
        this.cost = 0;
        this.gain = 0;
        this.wagerId = '';
        this.lastIndex = 0;
        this.currIndex = 0;

        this.frozenCost = 0;
        this.frozenGain = 0;
        this.state = 'init';

        this.lastFireTime = 0;
    };

    gameTokensSchema.methods.calcBalance = function (quota) {
        let num = 0;

        if (this.walletType == consts.walletType.multipleWallet) {
            num = utils.number.add(this.amount, this.gain);
            num = utils.number.sub(num, this.cost);
        } else {
            if (this.normalSingleWallet) {
                num = quota;
            } else {
                if (this.amount == 0) {
                    num = quota;
                } else {
                    num = utils.number.add(this.amount, this.gain);
                    num = utils.number.sub(num, this.cost);
                    num = utils.number.add(num, quota);
                }
            }
        }

        return num;
    };

    gameTokensSchema.methods.toClientData = function () {
        return {
            _id: this._id,
            playerId: this.playerId,
            total: this.oneAreaExchange,
            amount: this.amount,
            ratio: this.ratio,
            creditCode: this.creditCode,
            gameId: this.gameId,
            quota: this.quota,
            balance: this.balance
        };
    };

    mdbgoose.model('GameTokens', gameTokensSchema);


    let frozenBillSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: String, default: ''},
        playerId: {type: String, default: ''},
        gameId: {type: String, default: ''},
        wagerId: {type: String, default: ''},
        idx: {type: Number, default: 0},
        cost: {type: Number, default: 0},
        gain: {type: Number, default: 0},
        action: {type: String, default: ''},
        reason: {type: String, default: ''},
        betSucc: {type: Boolean, default: false},
        winSucc: {type: Boolean, default: false}
    }, {collection: 'frozen_bill'});

    frozenBillSchema.methods.toClientData = function () {
        return {};
    };

    mdbgoose.model('FrozenBill', frozenBillSchema);

};
