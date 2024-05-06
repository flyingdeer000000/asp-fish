let quick = require('quick-pomelo');
let P = quick.Promise;
const uuid = require('uuid/v1');
let util = require('util')
let utils = require('../utils/utils');
let logger = quick.logger.getLogger('fishrc', __filename);
let moment = require('moment-timezone');
let async = require('async');
let serverCnf = require('../../statics/config/development/common/serverCnf.json');
const CACHE_TIMEOUT = 5000;//�����^���@��
//=============================================================================

// let controlRTP = 98;
let controlRTP = {  // 預設98，若需特殊RTP則另外定義
    "common": 98,
    "10004": 96,
    "10005": 96,
    "10006": 96
};
let baseBet = 1000000;
let controlWeights = [20, 20, 20, 20, 20];
let controlDays = ['day_3', 'day_4', 'day_5', 'day_6', 'day_7'];
let recordDays = ['day_0', 'day_1', 'day_2', 'day_3', 'day_4', 'day_5', 'day_6', 'day_7'];
let controlAllWeights = [];

let tempTotalGain = 0;
let tempTotalCost = 0;

class GameWinLoseCounter {
    constructor(gameId) {
        this.gameId = gameId
        this.totalGain = 0;
        this.totalCost = 0;
    }

    addGain(value) {
        if (value) this.setGain(utils.number.add(this.getGain(), value));
    }

    setGain(value) {
        this.totalGain = value;
    }

    getGain() {
        return this.totalGain;
    }

    addCost(value) {
        if (value) this.setCost(utils.number.add(this.getCost(), value));
    }

    setCost(value) {
        this.totalCost = value;
    }

    getCost() {
        return this.totalCost;
    }
}

let gameWinLoseCounters = {};
serverCnf = serverCnf.fishGameId;
let gameCount = serverCnf.length - 1;
for (let i = 0; i <= gameCount; i++) {
    let oneGameWinLoseCounter = new GameWinLoseCounter(serverCnf[i]);
    gameWinLoseCounters[serverCnf[i]] = oneGameWinLoseCounter;
}

for (let count in controlWeights) {
    let ttlcount = controlWeights[count];
    for (let count_1 = 0; count_1 < ttlcount; count_1++) {
        controlAllWeights.push(controlDays[count]);
    }
}

let Controller = function (app) {
    this.app = app;
    this.creditCache = {};
    this.recordMsgCache = {};
    this.cacheTimerId = 0;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

Controller.prototype.start = function () {
    try {
        let self = this;

        async.auto({
            Init: function (finish) {
                let r_data = 0;
                self._initDBAsync();
                finish(null, r_data);
            }
        }, function (errs, results) {

        });
    } catch (err) {
        logger.error('[fishHunterRC][start] catch err:', err);
    }
};

proto.cache = function (creditCode, gameId, serverId, room, amount, event, dc, exchangeRate) {
    try {
        if (!this.creditCache[gameId]) {
            this.creditCache[gameId] = {};
        }

        if (!exchangeRate) {
            logger.error(`[fishHunterRC][cache] no exchangeRate. creditCode: ${creditCode}, gameId: ${gameId}, serverId: ${serverId}, amount: ${amount}`);
            return;
        }
        // let currencyConfig = this.app.controllers.fishHunterConfig.getCurrencyConfigByDC(dc);
        // if (!currencyConfig) currencyConfig = this.app.controllers.fishHunterConfig.getCurrencyConfig();
        // let exchangeRate = currencyConfig[creditCode].exchangeRate;

        if (!this.creditCache[gameId][room]) {
            this.creditCache[gameId][room] = {
                gain: 0,
                cost: 0
            };
        }

        let exchangeAmount = Math.abs(amount) * 1 / exchangeRate;
        let printLogData = {
            creditCode, gameId, serverId, room,
            amount: Math.abs(amount),
            event, dc, exchangeRate, exchangeAmount,
            before_cost: this.creditCache[gameId][room].cost,
            before_gain: this.creditCache[gameId][room].gain,
        };
        switch (event) {
            case this.RC_EVENT.COST:
                this.creditCache[gameId][room].cost += exchangeAmount;
                // this.creditCache[gameId][room].cost += Math.abs(amount) * 1/exchangeRate;
                break;
            case this.RC_EVENT.GAIN:
                this.creditCache[gameId][room].gain += exchangeAmount;
                // this.creditCache[gameId][room].gain += Math.abs(amount) * 1/exchangeRate;
                break;
            default:
                logger.error('[fishHunterRC][cache] unknow event.... creditCode:%s ,gameId:%s , serverId:%s , room:%s , amount:%s , event:%s ', creditCode, gameId, serverId, room, amount, event);
                break;
        }
        printLogData['after_cost'] = this.creditCache[gameId][room].cost;
        printLogData['after_gain'] = this.creditCache[gameId][room].gain;
        logger.info(`[fishHunterRC][cache] ${JSON.stringify({printLogData})}`);
    } catch (err) {
        logger.error('[fishHunterRC][cache] catch err:', err);
    }
}

proto.persistent = cort(function* () {
    try {
        let self = this;

        let games = Object.keys(this.creditCache);
        if (games.length == 0) {
            return;
        }

        yield self.processReloadRevenue();

        yield self.saveToDBAsync();

    } catch (err) {
        logger.error('[fishHunterRC][persistent] catch err:', err);
    }
});


proto.saveToDBAsync = cort(function* () {
    let self = this;

    return this.app.memdb.goose.transactionAsync(cort(function* () {
        let modelScoreInOut = self.app.models.FishHunterScoreInOut;
        let config = self.app.controllers.fishHunterConfig.getRCServerConfig();
        config = config.rcServers;
        for (let gameId in self.creditCache) {
            let rooms = self.creditCache[gameId];
            let rec = yield modelScoreInOut.findOneAsync({gameId: gameId});

            for (let room in rooms) {
                let cost = rooms[room].cost;
                let gain = rooms[room].gain;

                rooms[room].cost = 0;
                rooms[room].gain = 0;

                if (!!rec) {
                    rec.totalGain += gain;
                    rec.totalCost += cost;
                    rec.RTP = rec.totalGain / rec.totalCost;
                    rec.updateTime = moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS");//Date.now();

                    if (!rec.detail[room]) {
                        rec.detail[room] = {gain: 0, cost: 0};
                    }
                    rec.detail[room].gain += gain;
                    rec.detail[room].cost += Math.abs(cost);
//========================================================================//�Ƥ�����

                    if (!rec.backupData['day_0'].createTime) {
                        rec.backupData['day_0'].createTime = moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS");
                    } else if (new Date(rec.backupData["day_0"].createTime).getDay() != new Date(rec.updateTime).getDay())  //�ɶ��L�� �x�s����
                    {
                        for (let day = 7; day >= 0; day--) {
                            if (day < 7)
                                rec.backupData[recordDays[day + 1]] = rec.backupData[recordDays[day]];
                        }
                        rec.backupData['day_0'] = {};//day �M��
                        rec.backupData['day_0'] = {
                            "levels": {},
                            "detail": {},
                            "rcCounter": {},
                            "rcEndTime": {},
                            "rcStartTime": {}
                        };
                        rec.backupData['day_0'].createTime = moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS");
                    }

                    if (!rec.backupData['day_0']) {
                        rec.backupData['day_0'] = {
                            "levels": {},
                            "detail": {},
                            "rcCounter": {},
                            "rcEndTime": {},
                            "rcStartTime": {}
                        };
                    }

                    if (!rec.backupData['day_0'].detail[room]) {
                        rec.backupData['day_0'].detail[room] = {gain: 0, cost: 0};
                    }

                    rec.backupData['day_0']._id = rec._id;
                    rec.backupData['day_0'].gameId = rec.gameId;
                    rec.backupData['day_0'].master = rec.master;

                    rec.backupData['day_0'].totalCost += Math.abs(cost);
                    rec.backupData['day_0'].totalGain += gain;
                    rec.backupData['day_0'].RTP = rec.backupData['day_0'].totalGain / rec.backupData['day_0'].totalCost;//rec.RTP;
                    rec.backupData['day_0'].updateTime = rec.updateTime;
                    //rec.backupData['day_0'].createTime=rec.createTime;
                    rec.backupData['day_0'].detail[room].gain += gain;
                    rec.backupData['day_0'].detail[room].cost += Math.abs(cost);
//========================================================================
                } else {
                    self.creditCache[gameId][room].cost += cost;
                    self.creditCache[gameId][room].gain += gain;
                }
            }

            if (!!rec) {
                if (new Date(rec.updateTime).getTime() - new Date(rec.checkTime).getTime() > config.timeout * 1000)
                    rec.master = self.app.getServerId();

                rec.markModified('backupData');
                rec.markModified('detail');
                yield rec.saveAsync();

                if (rec.master == self.app.getServerId() && (new Date(rec.updateTime).getTime() - new Date(rec.checkTime).getTime() >= config.checkInterval * 1000)) {
                    setTimeout(() => {
                        self.checkRTP(gameId);
                    }, 5000);
                }
            }
        }
    }), this.app.getServerId())
        .catch(err => {
            logger.error('[fishHunterRC][saveToDBAsync] catch err:', err);
        })
})

proto._initDBAsync = function () {
    let self = this;

    return this.app.memdb.goose.transactionAsync(cort(function* () {

        let modelScoreInOut = self.app.models.FishHunterScoreInOut;

        let gameCount = serverCnf.length - 1;
        for (let i = 0; i <= gameCount; i++) {
            let gameID = serverCnf[i];

            let rec = yield modelScoreInOut.findOneAsync({gameId: gameID});
            if (!rec) {

                let initRTP = self.getGameControlRTP(gameID);
                let InitGain = initRTP * baseBet / 100; //98*100000/1000=9800
                let InitCost = baseBet;                 //100000

                let rec = new modelScoreInOut({
                    gameId: gameID,
                    _id: gameID + ':' + uuid(),
                    backupData: {
                        day_0: {
                            totalGain: 0,
                            totalCost: 0,
                            detail: {1: {gain: 0, cost: 0}, 2: {gain: 0, cost: 0}, 3: {gain: 0, cost: 0}}
                        },
                        day_1: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                        day_2: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                        day_3: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                        day_4: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                        day_5: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                        day_6: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                        day_7: {
                            totalGain: InitGain,
                            totalCost: InitCost,
                            detail: {
                                1: {gain: InitGain / 2, cost: InitCost / 2},
                                2: {gain: InitGain / 2, cost: InitCost / 2},
                                3: {gain: InitGain / 2, cost: InitCost / 2}
                            }
                        },
                    },
                    createTime: moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS"),//Date.now()
                    updateTime: moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS"),
                    master: self.app.getServerId(),
                    checkTime: moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS"),
                    RTP: 0,
                    totalGain: 0,
                    totalCost: 0
                });
                logger.info('[RC Init ] ' + JSON.stringify(rec));
                yield rec.saveAsync();
            }
        }
    }), this.app.getServerId())
        .catch(err => {
            logger.error('[fishHunterRC][_initDBAsync] catch err:', err);
        })
}

proto.checkRTP = function (gameId) {
    let self = this;

    let config = self.app.controllers.fishHunterConfig.getRCServerConfig();
    config = config.rcServers;
    let conf = config.levels[gameId];
    if (!conf) {
        logger.warn('[FishHunterRC][checkRTP] rcServerConfig.json 未設定 遊戲%s 的rcServers.levels，使用共用的common設定', gameId);
        //未設定則使用共用
        conf = config.levels["common"];
    }
    if (!conf) {
        logger.error('[fishHunterRC][persistent] return by:', 'rcServerConfig.json 未設定 common 的rcServers.levels，請修正！！！');
        return;
    }

    return this.app.memdb.goose.transactionAsync(cort(function* () {
        let modelScoreInOut = self.app.models.FishHunterScoreInOut;

        let rooms = self.creditCache[gameId];
        let rec = yield modelScoreInOut.findOneAsync({gameId: gameId});
        for (let room in rooms) {

            if (!!rec) {
                rec.checkTime = moment(Date.now()).format("YYYY-MM-DD HH:mm:ss:SSS");//Date.now();
                tempTotalGain = gameWinLoseCounters[gameId].getGain();
                tempTotalCost = gameWinLoseCounters[gameId].getCost();

                logger.info('[fishHunterRC][checkRTP] gameId: %s, tempTotalCost: %s, tempTotalGain: %s, gameWinLoseCounters: %s, rec: ', gameId, tempTotalCost, tempTotalGain, gameWinLoseCounters[gameId], rec);

                let vpt = conf.global;
                let rcEndTime = rec.rcEndTime['global'] || 0;

                logger.warn('[fishHunterRC][checkRTP] keep ', config.keepNormalTime, ' rcEndTime ', rcEndTime, ' ', Date.now() - rcEndTime > config.keepNormalTime * 1000);
                logger.info('[fishHunterRC][checkRTP] vpt: ,', vpt, ' rec.backupData[day_0]: ', rec.backupData['day_0'], ', ', (Date.now() - rcEndTime > config.keepNormalTime * 1000));

                if (!!vpt && rec.backupData['day_0'].totalGain > 0 && (Date.now() - rcEndTime > config.keepNormalTime * 1000)) {
                    let rtp = (rec.backupData['day_0'].totalGain + tempTotalGain) / (rec.backupData['day_0'].totalCost + tempTotalCost);//test
                    logger.info('[fishHunterRC][checkRTP] gameId: %s, rtp: ', gameId, rtp);
                    let tmp = null;

                    for (let it in vpt) {
                        if (rtp >= vpt[it].rtpMin && rtp < vpt[it].rtpMax) {
                            tmp = vpt[it].label;

                            break;
                        }
                    }
                    rec.checkRTP.global = {
                        totalCost: (rec.backupData['day_0'].totalCost + tempTotalCost),
                        totalGain: (rec.backupData['day_0'].totalGain + tempTotalGain)
                    };
                    logger.info('[fishHunterRC][checkRTP] gameId: %s, rec.checkRTP.global: ', gameId, rec.checkRTP.global);

                    if (!!tmp) {
                        rec.levels.global = tmp;

                        let t = rec.rcStartTime['global'] || 0;

                        if (Date.now() - t > config.riskControlTime * 1000) {
                            rec.rcStartTime['global'] = Date.now();
                            if (!rec.rcCounter['global']) {
                                rec.rcCounter['global'] = 0;
                            }
                            ++rec.rcCounter['global'];

                            if (rec.rcCounter['global'] > config.count) {
                                rec.levels.global = '';
                                rec.rcCounter['global'] = 0;

                                rec.rcEndTime['global'] = Date.now();
                                rec.markModified('rcEndTime');
                            }

                            rec.markModified('rcStartTime');
                            rec.markModified('rcCounter');
                        }
                    } else {
                        rec.levels[room] = '';
                        // logger.error('rec.levels[room]被設定為“”，tmp: %s, rtp: %s -1', tmp, rtp);
                    }

                    rec.markModified('levels');
                    rec.markModified('checkRTP');
                    logger.info(util.inspect({
                        gameId: gameId,
                        room: 'global',
                        rtp: rtp,
                        levels: rec.levels.global,
                        time: Date.now()
                    }, 6));
                }

                try {
                    rcEndTime = rec.rcEndTime[room] || 0;
                    // 有可能遇到剛 rcRemote.addRecord 寫進房間資料後，還未執行 saveToDBAsync 創好mongo空間就被前次執行saveToDBAsync時timer觸發的checkRTP使用，故擋掉當次處理
                    if (!!rec.detail[room]) {
                        if (!!conf[room] && rec.detail[room].gain > 0 && (Date.now() - rcEndTime > config.keepNormalTime * 1000)) {
                            vpt = conf[room];

                            let rtp = (rec.backupData['day_0'].detail[room].gain + tempTotalGain) / (rec.backupData['day_0'].detail[room].cost + tempTotalCost);//test
                            let tmp = null;

                            logger.warn('[fishHunterRC][checkRTP] gameId:%s, room:%s, RTP:%s', gameId, room, rtp);

                            for (let it in vpt) {
                                if (rtp >= vpt[it].rtpMin && rtp < vpt[it].rtpMax) {
                                    tmp = vpt[it].label;

                                    break;
                                }
                            }

                            if (!!tmp) {
                                rec.levels[room] = tmp;

                                let t = rec.rcStartTime[room] || 0;

                                if (Date.now() - t > config.riskControlTime * 1000) {
                                    rec.rcStartTime[room] = Date.now();
                                    if (!rec.rcCounter[room]) {
                                        rec.rcCounter[room] = 0;
                                    }
                                    ++rec.rcCounter[room];

                                    if (rec.rcCounter[room] > config.count) {
                                        rec.levels[room] = '';
                                        // logger.error('rec.levels[room]被設定為“”，rec.rcCounter[room]: %s, config.count: %s, rtp: %s', rec.rcCounter[room], config.count, rtp);
                                        rec.rcCounter[room] = 0;
                                        rec.rcEndTime[room] = Date.now();

                                        rec.markModified('rcEndTime');
                                    }

                                    rec.markModified('rcStartTime');
                                    rec.markModified('rcCounter');
                                }
                            } else {
                                rec.levels[room] = '';
                                // logger.error('rec.levels[room]被設定為“”，tmp: %s, rtp: %s -2', tmp, rtp);
                            }

                            rec.markModified('levels');

                            logger.info(util.inspect({
                                gameId: gameId,
                                room: room,
                                rtp: rtp,
                                levels: rec.levels[room],
                                time: Date.now()
                            }, 6));
                        }
                    }

                } catch (err) {
                    logger.error('[fishHunterRC][catch] rec: %s, gameId: %s, room: %s,  err: ', JSON.stringify(rec), gameId, room, err);
                }

                //======================================================================================
                rec.backupData['day_0'].levels = rec.levels;
                rec.backupData['day_0'].checkTime = rec.checkTime;
                rec.backupData['day_0'].rcStartTime = rec.rcStartTime;
                rec.backupData['day_0'].rcEndTime = rec.rcEndTime;
                rec.backupData['day_0'].rcCounter = rec.rcCounter;

                rec.markModified('backupData');
                //======================================================================================
                yield rec.saveAsync();
            } else {
                logger.warn('[FishHunterRC][checkRTP] 遊戲%s not find RC ScoreInOut: ', gameId, rec);
            }
        }
    }), this.app.getServerId())
        .catch(err => {
            logger.error('[fishHunterRC][checkRTP] gameId = %s. catch err:', gameId, err);
        })
}

proto.sendRecordMsgBatch = function (data, dc, exchangeRate) {
    try {
        logger.info('[fishHunterRC][sendRecordMsgBatch] data: ', data);

        let rpc = this.app.rpc.fishHunterRC.rcRemote;
        let svrId = this.app.getServerId();

        for (let k in data) {
            rpc.addRecord(svrId, data[k].creditCode, data[k].gameId, svrId, data[k].room, data[k].amount, data[k].event, dc, exchangeRate, function (err, res) {

            });
        }
    } catch (err) {
        logger.error('[fishHunterRC][sendRecordMsgBatch] catch err: %s, data: %s', err, data);
    }
}

proto.addRecord = cort(function* (creditCode, gameId, room, amount, event, dc, exchangeRate) {
    try {
        logger.info('[fishHunterRC][addRecord] event: %s, amount: %s, creditCode: %s, exchangeRate: %s, dc: %s, room: %s, gameId: %s', event, amount, creditCode, exchangeRate, dc, room, gameId);
        if (CACHE_TIMEOUT == 0) {
            let rpc = this.app.rpc.fishHunterRC.rcRemote;
            let svrId = this.app.getServerId();

            rpc.addRecord(svrId, creditCode, gameId, svrId, room, amount, event, dc, exchangeRate, function (err, res) {

            });
        } else {
            if (this.cacheTimerId == 0) {
                this.cacheTimerId = setTimeout(() => {
                    let data = this.recordMsgCache;
                    this.recordMsgCache = {};
                    this.cacheTimerId = 0;

                    this.sendRecordMsgBatch(data, dc, exchangeRate);

                }, CACHE_TIMEOUT);
            }

            let key = [gameId, room, event].join('_');
            if (!this.recordMsgCache[key]) {
                this.recordMsgCache[key] = {
                    gameId: gameId,
                    room: room,
                    event: event,
                    amount: amount,
                    creditCode: creditCode
                }
            } else {
                this.recordMsgCache[key].amount += amount;
            }
        }
    } catch (err) {
        logger.error('[fishHunterRC][addRecord] catch err: %s, creditCode: %s, gameId: %s, room: %s, amount: %s, event: %s', err, creditCode, gameId, room, amount, event);
    }
});

proto.RC_EVENT = {
    COST: 'cost',
    GAIN: 'gain'
}

Controller.prototype.processReloadRevenue = cort(function* () {
    let self = this;

    return this.app.memdb.goose.transactionAsync(cort(function* () {
        let modelScoreInOut = self.app.models.FishHunterScoreInOut;
        let controlIndex = Math.floor(Math.random() * Math.floor(controlAllWeights.length));
        let controlDaykey = controlAllWeights[controlIndex];

        let gameCount = serverCnf.length - 1;
        for (let i = 0; i <= gameCount; i++) {
            let gameID = serverCnf[i];

            gameWinLoseCounters[gameID].setGain(0);
            gameWinLoseCounters[gameID].setCost(0);

            // let rec = yield modelScoreInOut.findOneAsync({gameId:gameID});
            let rec = yield modelScoreInOut.findOneReadOnlyAsync({gameId: gameID});

            gameWinLoseCounters[gameID].addCost(rec.backupData['day_1'].totalCost);
            gameWinLoseCounters[gameID].addGain(rec.backupData['day_1'].totalGain);
            gameWinLoseCounters[gameID].addCost(rec.backupData['day_2'].totalCost);
            gameWinLoseCounters[gameID].addGain(rec.backupData['day_2'].totalGain);

            if (controlDaykey == 'day_3') {
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_3'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_3'].totalGain);
            }
            if (controlDaykey == 'day_4') {
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_3'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_3'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_4'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_4'].totalGain);
            }
            if (controlDaykey == 'day_5') {
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_3'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_3'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_4'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_4'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_5'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_5'].totalGain);
            }
            if (controlDaykey == 'day_6') {
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_3'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_3'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_4'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_4'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_5'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_5'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_6'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_6'].totalGain);
            }
            if (controlDaykey == 'day_7') {
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_3'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_3'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_4'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_4'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_5'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_5'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_6'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_6'].totalGain);
                gameWinLoseCounters[gameID].addCost(rec.backupData['day_7'].totalCost);
                gameWinLoseCounters[gameID].addGain(rec.backupData['day_7'].totalGain);
            }
        }
    }), this.app.getServerId())
        .catch(err => {
            logger.error('[fishHunterRC][processReloadRevenue] catch err:', err);
        })
});

proto.getGameControlRTP = function (gameId) {
    try {
        return controlRTP[gameId] || controlRTP["common"];
    } catch (err) {
        logger.error('[fishHunterRC][getGameControlRTP] catch err: %s, data: %s', err, data);
        return 0;
    }
}
