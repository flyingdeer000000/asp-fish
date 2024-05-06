'use strict';
let utils = require('../utils/utils');
module.exports = function (app) {
    let mdbgoose = app.memdb.goose;

    let playerSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        userName: {type: String, default: ''},
        createTime: {type: String, default: 0},
        updateTime: {type: String, default: 0},
        hallId: {type: String, default: ''},
        gameServerId: {type: String, default: ''},
        backendServerId: {type: String, default: ''},
        gameId: {type: String, default: ''},
        connectorId: {type: String, default: ''},
        tableId: {type: String, default: ''},
        tableLevel: {type: Number, default: 0},
        nickName: {type: String, default: ''},
        gameState: {type: String, default: ''},
        areaId: {type: String, default: ''},
        loginIp: {type: String, default: ''},
        clientType: {type: String, default: ''},
        gold: {type: Number, default: 0},
        accountState: {type: String, default: ''},
        currency: {type: String, default: 'CNY'},
        launchToken: {type: String, default: ''},
        isPromo: {type: Boolean, default: false},
        dc: {type: String, default: ''},
        platformPlayerId: {type: String, default: ''},
        isSingleWallet: {type: mdbgoose.Schema.Types.Mixed, default: 0},
        roundID: {type: Number, default: 0},
        wId: {type: String, default: ''},
        demo: {type: Number, default: 0},
        upid: {type: String, default: ''},
        mySQLWallet: {type: Boolean, default: false},
    }, {collection: 'fish_hunter_player'});

    playerSchema.statics.getUpdatableKeys = function () {
        return ['nickName', 'avatarUrl', 'gender'];
    };

    playerSchema.statics.getInternalUpdatableKeys = function () {
        return ['tableId', 'gameState', 'areaId', 'tableLevel', 'backendServerId'];
    };

    playerSchema.methods.toClientData = function () {
        return {
            nickName: this.nickName,
            gameServerId: this.gameServerId,
            connectorId: this.connectorId,
            hallId: this.hallId,
            gameId: this.gameId,
            tableId: this.tableId,
            gameState: this.gameState,
            id: this._id,
            areaId: this.areaId,
            gold: this.gold,
            currency: this.currency,
        };
    };

    mdbgoose.model('FishHunterPlayer', playerSchema);

    let areaSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: String, default: 0},
        updateTime: {type: Number, default: 0},
        sceneTimer: {type: Number, default: 0},
        switchSceneDelayTimer: {type: Number, default: 0},
        stage: {type: String, default: ''},
        tableId: {type: String, default: ''},
        scene: {type: Number, default: 0},
        state: {type: String, default: ''},
        changeSceneTimeDelay: {type: mdbgoose.Schema.Types.Mixed, default: null},
        pauseTime: {type: Number, default: 0},
        tableLevel: {type: Number, default: 0},
        gameId: {type: String, default: ''},
        scenarioTime: {type: Number, default: 0},
    }, {collection: 'fish_hunter_area'});

    areaSchema.methods.toClientData = function () {
        return {
            id: this._id,
            scene: this.scene,
            state: this.state,
            pauseTime: this.pauseTime,
            tableLevel: this.tableLevel,
            gameId: this.gameId,
        };
    };

    mdbgoose.model('FishHunterArea', areaSchema);

    let areaPlayersSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: String, default: utils.timeConvert(Date.now(), true)},
        areaId: {type: String, default: ''},
        playerId: {type: String, default: ''},
        bullets: {type: Array, default: []},
        lastFireTime: {type: Number, default: 0},
        cannonLevel: {type: Number, default: 0},
        tableLevel: {type: Number, default: 0},
        lockTargetId: {type: Number, default: 0},
        gain: {type: Number, default: 0},
        cost: {type: Number, default: 0},
        loginIp: {type: String, default: ''},
        clientType: {type: String, default: ''},
        gameId: {type: String, default: '10001'},
        gunEx: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        // beforeBalance:{type : Number, default:0},
        // afterBalance:{type : Number, default:0},
        denom: {type: Number, default: 0},
        chairId: {type: Number, default: 0},
        gunInfo: {type: Array, default: []},
        dc: {type: String, default: ''},
        currency: {type: String, default: 'CNY'},
        isBonusGame: {type: Number, default: 0},
        isPromo: {type: Boolean, default: false}
    }, {collection: 'fish_hunter_area_players'});

    areaPlayersSchema.statics.getUpdatableKeys = function () {
        return ['isBonusGame'];
    };

    areaPlayersSchema.methods.toClientData = function (betSetting) {
        // let currencyConfig = app.controllers.fishHunterConfig.getCurrencyConfigByDC(this.dc);
        // if (!currencyConfig) currencyConfig = app.controllers.fishHunterConfig.getCurrencyConfig();
        // let currencyCannon = currencyConfig[(this.currency?this.currency:'CNY')].cannon;

        let cannon = {
            // cost: currencyCannon.cost[this.tableLevel],
            // level: currencyCannon.level[this.tableLevel]
            cost: betSetting.info.levels[this.tableLevel].cannon.cost,
            level: betSetting.info.levels[this.tableLevel].cannon.level
        };
        let level = 0;
        let cost = cannon.cost[this.cannonLevel];

        for (let i = 0; i < cannon.level.length; i++) {
            if (cost <= cannon.level[i]) {
                level = i;
                break;
            }
        }

        return {
            id: this._id,
            areaId: this.areaId,
            playerId: this.playerId,
            cannonLevel: this.cannonLevel,
            cannonCost: cost,
            level: level,
            lockTargetId: this.lockTargetId,
            chairId: this.chairId,
            gunEx: this.gunEx,
            denom: this.denom,
            gunInfo: this.gunInfo,
            loginIp: this.loginIp
        };
    };

    mdbgoose.model('FishHunterAreaPlayers', areaPlayersSchema);

    let areaPlayersHistorySchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: String, default: ''},
        areaId: {type: String, default: ''},
        playerId: {type: String, default: ''},
        // bullets: {type: Array, default: []},
        // lastFireTime: {type: String, default: 0},
        // cannonLevel: {type: Number, default: 0},
        // tableLevel: {type: Number, default: 0},
        // lockTargetId: {type: Number, default: 0},
        gain: {type: Number, default: 0},
        cost: {type: Number, default: 0},
        // loginIp: {type: String, default: ''},
        // clientType: {type: String, default: ''},
        gameId: {type: String, default: '10001'},
        beforeBalance: {type: Number, default: 0},
        afterBalance: {type: Number, default: 0},
        denom: {type: Number, default: 0},
        // chairId: {type: Number, default: 0},
        gunInfo: {type: Array, default: []},
        repair: {type: Number, default: 0},
        currency: {type: String, default: 'CNY'},
        isBonusGame: {type: Number, default: 0},
        roundID: {type: Number, default: 0},
    }, {collection: 'fish_hunter_area_players_history'});

    areaPlayersHistorySchema.methods.toClientData = function () {
        return {
            _id: this._id,
            createTime: this.createTime,
            areaId: this.areaId,
            playerId: this.playerId,
            gain: this.gain,
            cost: this.cost,
            loginIp: this.loginIp,
            clientType: this.clientType,
            beforeBalance: this.beforeBalance,
            afterBalance: this.afterBalance,
            denom: this.denom,
            creditCode: this.creditCode,
            gameId: this.gameId,
            // chairId: this.chairId,
            gunInfo: this.gunInfo
        };
    };

    mdbgoose.model('FishHunterAreaPlayersHistory', areaPlayersHistorySchema);


    // let bulletsSchema = new mdbgoose.Schema({
    //   _id: {type: String, default: ''},
    //   createTime: {type: Number, default: 1},
    //   areaId: {type: String, default: ''},
    //   playerId: {type: String, default: ''},
    //   bulletId: {type: Number, default: 1},
    //   angle: {type: Number, default: 0},
    //   cost: {type: Number, default: 0},
    //   lockTargetId: {type: Number, default: 0},
    //   chairId: {type: Number, default: 0}
    // }, {collection: 'fish_hunter_bullets'});
    //
    // bulletsSchema.methods.toClientData = function () {
    //   return {
    //     createTime: this.createTime,
    //     areaId: this.areaId,
    //     playerId: this.playerId,
    //     bulletId: this.bulletId,
    //     angle: this.angle,
    //     cost: this.cost,
    //     lockTargetId: this.lockTargetId,
    //     chairId: this.chairId
    //   };
    // };
    //
    // mdbgoose.model('FishHunterBullets', bulletsSchema);


    let bulletsHistorySchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: String, default: 0},
        areaId: {type: String, default: ''},
        playerId: {type: String, default: ''},
        bulletId: {type: Number, default: 1},
        cost: {type: Number, default: 0},
        gain: {type: Number, default: 0},
        // lockTargetId: {type: Number, default: 0},
        // chairId: {type: Number, default: 0},
        hitFishes: {type: String, default: ''},
        killFishes: {type: Boolean, default: false},
        denom: {type: Number, default: 0},
        endReason: {type: String, default: ''},
        shootType: {type: String, default: ''},			    //子彈類型: normal一般子彈/bazooka/
        // endFireTime: {type: String, default: 0},		    //子彈發射的時間
        // ColliderTime: {type: String, default: 0},		    //子彈碰撞的時間
        finishTime: {type: String, default: ''},	//派彩完成時間
        // beforeFireBalance: {type: Number, default: 0},	//子彈發射前餘額
        // afterFireBalance: {type: Number, default: 0},	  //子彈發射後餘額
        // beforeBalance: {type: Number, default: 0},	  	//子彈碰撞前餘額
        // afterBalance: {type: Number, default: 0},	    	//子彈碰撞後餘額
        alive: {type: Number, default: 0},				      //這發結束後剩餘碰撞次數(drill/laser)
        returnInfo: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        getInfo: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        repair: {type: Number, default: 0},
        wId: {type: String, default: ''},
        idx: {type: Number, default: 0}
    }, {collection: 'fish_hunter_bullets_history'});

    bulletsHistorySchema.methods.toClientData = function () {
        return {
            _id: this._id,
            bulletId: this.bulletId,
            cost: this.cost,
            gain: this.gain,
            areaId: this.areaId,
            createTime: this.endTime,
            hitFishes: this.hitFishes,
            killFishes: this.killFishes,
            denom: this.denom
        };
    };

    mdbgoose.model('FishHunterBulletsHistory', bulletsHistorySchema);

    let activeAreasSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        areaIds: {type: [String], default: []}
    }, {collection: 'fish_hunter_active_areas'});

    activeAreasSchema.methods.toClientData = function () {
        return {};
    };

    mdbgoose.model('FishHunterActiveAreas', activeAreasSchema);


    // let areaFishesSchema = new mdbgoose.Schema({
    //   _id: {type: String, default: ''},
    //   areaId: {type: String, default: ''},
    //   id: {type: Number, default: -1},
    //   type: {type: String, default: ''},
    //   amount: {type: Number, default: 0},
    //   born: {type: Number, default: 0},
    //   alive: {type: Number, default: 0},
    //   state: {type: String, default: ''},
    //   path: {type: String, default: ''},
    //   index: {type: Number, default: 0},
    //   score: {type: Number, default: 0},
    //   maxHp: {type: Number, default: 0},
    //   hp: {type: Number, default: 0},
    // }, {collection: 'fish_hunter_area_fishes'});
    //
    // areaFishesSchema.methods.getHpPercent = function () {
    //   return utils.number.divide(this.hp, this.maxHp).toFixed(2);;
    // };
    //
    // areaFishesSchema.methods.toClientData = function () {
    //   return {};
    // };
    //
    // mdbgoose.model('FishHunterAreaFishes', areaFishesSchema);

    // let areaFishesReincarnationHistorySchema = new mdbgoose.Schema({
    //   _id: {type: String, default: ''},
    //   fId: {type: String, default: ''},
    //   born: {type: Number, default: 0},
    //   deadat: {type: Number, default: 0},
    //   oldtype: {type: String, default: ''},
    //   newtype: {type: String, default: ''},
    // }, {collection: 'fish_hunter_area_fishes_ReincarnationHistory'});
    //
    // mdbgoose.model('areaFisheReincarnationHistory', areaFishesReincarnationHistorySchema);

    let subRecordSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        createTime: {type: Number, default: 1},
        areaId: {type: String, default: ''},
        playerId: {type: String, default: ''},
        cost: {type: Number, default: 0},
        gain: {type: Number, default: 0},
        betId: {type: Number, default: 0},
        bullets: {type: [mdbgoose.Schema.Types.Mixed], default: []},
        fishSummary: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        denom: {type: Number, default: 0},
    }, {collection: 'fish_hunter_sub_record'});

    subRecordSchema.methods.toClientData = function () {
        return {};
    };

    mdbgoose.model('FishHunterSubRecord', subRecordSchema);

    let scoreInOutSchema = new mdbgoose.Schema({
        _id: {type: String, default: ''},
        backupData: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        checkRTP: {type: mdbgoose.Schema.Types.Mixed,
            default: {
                '1': {totalCost: 0, totalGain: 0},
                '2': {totalCost: 0, totalGain: 0},
                'global': {totalCost: 0, totalGain: 0}
            }
        },
        createTime: {type: String, default: ''},
        updateTime: {type: String, default: ''},
        master: {type: String, default: ''},
        checkTime: {type: String, default: ''},
        totalGain: {type: Number, default: 0},
        totalCost: {type: Number, default: 0},
        RTP: {type: Number, default: 0},
        detail: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        levels: {type: mdbgoose.Schema.Types.Mixed, default: {global: 'normal'}},
        rcStartTime: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        rcEndTime: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        rcCounter: {type: mdbgoose.Schema.Types.Mixed, default: {}},
        gameId: {type: String, default: ''},
    }, {collection: 'fish_hunter_score_in_out'});

    scoreInOutSchema.methods.toClientData = function () {
        return {};
    };

    mdbgoose.model('FishHunterScoreInOut', scoreInOutSchema);
};
