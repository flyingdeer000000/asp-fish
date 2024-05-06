'use strict';

let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let consts = require('../../share/consts');
const uuid = require('uuid/v1');
let logger = quick.logger.getLogger('connector', __filename);
let loggerArea = quick.logger.getLogger('area', __filename);
let utils = require('../utils/utils');
let m_objRNGMethod;
let FishPool = require('../domain/area/fishPool');

let Controller = function (app) {
    this.app = app;
    let self = this;
    self.localFishIds = [];
    let strRNGPath = './lib/RNG/GameLogicInterface';
    // let strRNGPath = app.getBase() + '/lib/RNG/GameLogicInterface';
    m_objRNGMethod = utils.randProbability.loadRNGDll(strRNGPath);

    this.fishPools = {};
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

proto._getPool = function (areaId) {
    if (!!this.fishPools[areaId]) {
        return this.fishPools[areaId];
    }

    let pool = new FishPool(this.app, areaId);
    this.fishPools[areaId] = pool;

    return pool;
}

proto._delPool = function (areaId) {
    Object.keys(this.fishPools[areaId].fishObjs).forEach((id) => {
        this.fishPools[areaId].delFish(id);
    });
    delete this.fishPools[areaId];
}

// proto.checkPauseStateAsync = cort(function* (area) {
//   let self = this;
//
//   // let modelArea = self.app.models.FishHunterArea;
//   // let tmp = yield modelArea.findByIdReadOnlyAsync(area._id);
//   let tmp = self.app.controllers.fishHunterCache.findFishArea(area._id);
//
//   if(!tmp) {
//     return 0;
//   }
//
//   if(tmp.pauseTime > area.pauseTime) {
//     let config = self.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
//     let pauseDelta = config.scene.PAUSE_SCREEN_TIME_DELAY || 5000;
//
//     if (Date.now() - area.pauseTime < pauseDelta) {
//       pauseDelta = Date.now() - area.pauseTime;
//     }
//     area.pauseTime = tmp.pauseTime;
//
//     return pauseDelta;
//   }
//   else {
//     return 0;
//   }
// })

proto.repickBiggestFish = cort(function* (area) {
    return area;
});

proto.removeDeactiveAreaFishes = cort(function* (area, isEnd) {
    if (!area) return;
    let self = this;

    if (isEnd) {
        self._delPool(area._id);
    } else {
        let pool = self._getPool(area._id);
        if (!!pool) {
            pool.cleanFish();
        }
    }

    // return self.app.memdb.goose.transactionAsync(cort(function*() {
    //   let fishes = yield self.app.models.FishHunterAreaFishes.findAsync({areaId: area._id});
    //   for (let fish of fishes) {
    //     if (!isEnd && fish.id == 0) continue; // 魚場結束前不清第0隻魚
    //     yield fish.removeAsync();
    //   }
    // }), self.app.getServerId())
    // .catch((err) => {
    //   logger.error('removeDeactiveAreaFishes areaId: %s, err: ', area._id, err);
    // });
});

proto.onWaitTimerAsync = cort(function* (area) {
    let time = Date.now();
    let config = this.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
    let changeSceneTimeWait = config.scene.CHANGE_SCENE_TIME_WAIT != -1 ? config.scene.CHANGE_SCENE_TIME_WAIT : 3000;
    if (time - area.switchSceneDelayTimer >= changeSceneTimeWait) {
        area.stage = 'normal';
        area.scenarioTime = time;     // 更新腳本時間
        area.sceneTimer = time - config.scene.NORMAL_FISH_TIME_DELAY - 2;
    }
});

proto.onChangeSceneAsync = cort(function* (area) {
    try {
        let config = this.app.controllers.fishHunterConfig.getGameConfig(area.gameId, area.tableLevel);
        ++area.scene;
        area.scene %= config.scene.MAX_SCENE;
        config = this.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
        this.app.controllers.table.pushAsync(area.tableId, null, consts.route.client.game.CHANGE_SCENE, {
            scene: area.scene,
            sceneWaitTime: config.scene.CHANGE_SCENE_TIME_WAIT,
        }, false);
        area.switchSceneDelayTimer = Date.now();
        area.changeSceneTimeDelay = null;
        // 換場清空memdb的魚 但保留第0隻
        yield this.removeDeactiveAreaFishes(area);
    } catch (err) {
        logger.error('[fishHunterArea][onChangeSceneAsync] areaId: %s, err ', area._id, err)
    }
});

proto.insertAreaFish = function (areaId, newFishes, fishTypeConfig, gameId) {
    loggerArea.debug('insertAreaFish ', newFishes.length);

    try {
        let self = this;
        let pool = self._getPool(areaId);

        if (!pool) {
            logger.error('insertAreaFish no pool ', areaId);
            return
        }

        for (let i = 0; i < newFishes.length; i++) {
            let opts = newFishes[i];
            opts._id = areaId + opts.id;
            opts.areaId = areaId;
            // opts.type = opts.type;
            // 有血量制的魚再存
            if (fishTypeConfig.AllFish[opts.type].hpProb) {
                // 血量 = 平均倍數 * hpProb
                opts.maxHp = opts.hp = utils.number.multiply(opts.score, fishTypeConfig.AllFish[opts.type].hpProb);
            }

            pool.addFish(opts._id, opts.id, opts.type, opts, gameId);
        }

        // let modelAreaFishes = this.app.models.FishHunterAreaFishes;
        // for (let i = 0; i < newFishes.length; i++) {
        //   (function (idx) {
        //     self.app.memdb.goose.transactionAsync(cort(function*() {
        //       let opts = newFishes[idx];
        //       opts._id = areaId + opts.id;
        //       opts.areaId = areaId;
        //       opts.type = opts.type;
        //       // opts.born = opts.born;
        //       // opts.id = opts.id;
        //       // opts.amount = opts.amount;
        //       // opts.alive = opts.alive;
        //       // opts.state = opts.state;
        //       // opts.index = opts.index;
        //       // opts.score = opts.score;

        //       // 有血量制的魚再存
        //       if (fishTypeConfig.AllFish[opts.type].hpProb) {
        //         opts.maxHp = opts.hp = opts.score;
        //       }
        //       let temp = new modelAreaFishes(opts);
        //       yield temp.saveAsync();
        //     }), self.app.getServerId());
        //   })(i);
        // }
    } catch (err) {
        logger.error('[fishHunterArea][insertAreaFish] areaId: %s, newFishes: %s, err: ', areaId, JSON.stringify(newFishes), err);
    }
};

// proto.randInt = function (min, max) {
//   let ret = min + Math.random() * (max - min);
//
//   return Math.floor(ret);
// };

proto.getAllFishes = function (areaId) {
    try {
        let pool = this._getPool(areaId);
        if (!pool) {
            throw ('pool not exist');
        }

        return pool.getAllFishes();
    } catch (err) {
        logger.error('[fishHunterArea][getAllFishes][catch] areaId: %s, err: ', areaId, err);
        return [];
    }
}

proto.updateFish = function (areaId, id, opts) {
    try {
        let pool = this._getPool(areaId);
        if (!pool) {
            throw ('pool not exist');
        }

        return pool.updateFish(id, opts);
    } catch (err) {
        logger.error('[fishHunterArea][updateFish][catch] areaId: %s, id: %s, opts: %s, err: ', areaId, id, JSON.stringify(opts), err);
        return null;
    }
}

proto.getFishData = function (areaId, id) {
    try {
        let pool = this._getPool(areaId);
        if (!pool) {
            throw ('pool not exist');
        }

        return pool.getFishData(id);
    } catch (err) {
        logger.error('[fishHunterArea][getFishData][catch] areaId: %s, id: %s, err: ', areaId, id, err);
        return null;
    }
}

proto.searchFish = function (areaId, opts) {
    try {
        let pool = this._getPool(areaId);
        if (!pool) {
            throw ('pool not exist');
        }

        return pool.searchFish(opts);
    } catch (err) {
        logger.error('[fishHunterArea][searchFish][catch] areaId: %s, opts: %s, err: ', areaId, JSON.stringify(opts), err);
        return [];
    }
}

proto.updateAreaSceneTimeDelay = function (areaId, killShowTime) {
    try {
        let self = this;
        let area = self.app.controllers.fishHunterCache.findFishArea(areaId);
        if (!area) return {};
        if (area.stage === consts.AreaStage.WAIT) return {}; // 已經在換場就不需處理 Delay Time
        // 新的換場 Delay 時間 = (計算該場開場多久) + 死亡動畫秒數
        area.changeSceneTimeDelay = (Date.now() - area.sceneTimer) + killShowTime;
        return {error: null};
    } catch (err) {
        logger.error('[areaRemote][updateAreaSceneTimeDelay] areaId: %s, killShowTime: %s, err: ', areaId, killShowTime, err);
        return {code: C.ERROR, reason: err};
    }
};
/////////////////// new swapn fish ///////////////////////////////////
proto._makeFishObject = cort(function* (area, alive, state, index, sceneFishIds, scenePaths, fid) {
    try {
        let time = Date.now();
        let fishScore = this.app.controllers.fishHunterConfig.getFishScoreConfig(area.gameId);
        let pathsconfig = this.app.controllers.fishHunterConfig.getFishPathConfig(area.gameId);
        let paths = Object.keys(pathsconfig);
        let path = '';
        let type = '';

        // path 路徑
        if (_.isString(scenePaths)) {
            path = scenePaths;
        } else if (!!scenePaths && scenePaths.length > 0) {
            path = _.sample(scenePaths);
        } else {
            path = _.sample(paths);
        }
        // type 魚種
        if (_.isString(sceneFishIds)) {
            type = sceneFishIds;
        } else if (!!sceneFishIds && sceneFishIds.length > 0) {
            type = _.sample(sceneFishIds);
        } else {
            type = utils.randProbability.getRand(config.fish.spawn.soloFish, 'prob', m_objRNGMethod).id;
        }

        // 檢查score賠率設定檔
        if (!fishScore[type]) {
            //logger.error('_makeFishObject invalid fish type ',type);
            return null;
        }

        let opts = {
            type: type,
            amount: 1,
            born: time,
            alive: alive,
            state: state,
            path: path,
            index: index,
            score: fishScore[type].avg // 非實際平均賠率
        }

        opts.id = (fid * 100) + index;

        return opts;
    } catch (err) {
        logger.error('[fishHunterArea][_makeFishObject] area: %s, sceneFishIds: %s, err: ', JSON.stringify(area), sceneFishIds, err);
    }
});

proto._parseFlockData = function (flockData, type, path, fishIds, bornCount) {
    /* flockData:
     * { layer_id_0: { types: [ 'Fish_002' ], points: [{ x: 0.22522522522490362, y: 2.2747747747747553 }],
          anim: { path: 'bz_id_8', repeat: 5, interval: 1.5, rate: 1, mode: 'normal' },
          anchor: { x: 1260, y: 1010 } }, layer_id_1: { ... } }
     * type: null || onBornFish('Fish_100'), path: [], fishIds: 'FS_1-1_o1', bornCount: null || onBornFish(1)
     */
    try {
        let fTypes = [];
        let fPaths = [];
        let count = 0;

        if (!!flockData) {

            if (!type || type.length == 0) {
                type = null;
            }

            if (!path || path.length == 0) {
                path = null;
            }

            let layers = Object.keys(flockData);
            if (!!bornCount) layers = [layers[Math.floor(Math.random() * layers.length)]]; // debug出魚: 隨機取一個layer
            for (let k = 0; k < layers.length; k++) {
                let ts = type; // null || onBornFish('Fish_100')
                let pt = path;
                let repeat = bornCount || flockData[layers[k]].points.length * flockData[layers[k]].anim.repeat;
                // let ct = flockData[layers[k]].points.length * flockData[layers[k]].anim.repeat;

                if (!ts) {
                    ts = _.sample(flockData[layers[k]].types);
                }

                if (!pt) {
                    if (!!fishIds) {
                        pt = fishIds + '|' + flockData[layers[k]].anim.path;
                    } else {
                        pt = flockData[layers[k]].anim.path;
                    }
                } else {
                    pt = pt[_.random(0, pt.length - 1)];
                    if (!!fishIds) {
                        pt = fishIds + '|' + pt;
                    }
                }

                fTypes = fTypes.concat(new Array(repeat).fill(ts));
                fPaths = fPaths.concat(new Array(repeat).fill(pt));
                count += repeat;
            }

            return {count: count, types: fTypes, paths: fPaths};
        } else {
            //logger.error('_parseFlockData no flockData ', flockData);

            return null;
        }
    } catch (err) {
        logger.error('[fishHunterArea][_parseFlockData] flockData: %s, fishIds: %s, err: ', JSON.stringify(flockData), fishIds, err);
    }
}

proto._sendNotice = function (area, route, fishes, isDebug) {
    try {
        if (this.app.get('env') !== 'development') return; // 不是測試版: 不送生魚訊息給前端

        if (fishes.length > 0) {
            let data = fishes.map((value) => {
                let fish = {
                    id: value.id,
                    type: value.type,
                    alive: value.alive,
                    state: value.state,
                    path: value.path,
                    index: value.index
                };
                if (!!isDebug) fish['debug'] = true; // debug 生魚通知前端
                return fish;
            });

            this.app.controllers.table.pushAsync(area.tableId, null, route, {fishes: data}, false);
        }
    } catch (err) {
        logger.error('[fishHunterArea][_sendNotice] area: %s, fishes: %s, err: ', JSON.stringify(area), JSON.stringify(fishes), err);
    }
}

proto._spawnFish = cort(function* (area, alive, sceneData, state, fid, sceneId) {
    /* alive: 25, sceneData: { type: 'flock', fishIds: [ 'FS_1-2_o1' ], paths: [] },
     * state: 'flock', fid: 1, sceneId: 'FS_1-1_o1'
     */
    try {
        let newFishes = [];
        let flockConfig = this.app.controllers.fishHunterConfig.getFishFlockConfig(area.gameId);
        /* flockConfig:
         * { FS_1-2_o1:
            { layer_id_0:
              { types: [ 'Fish_002' ], points: [{ x: 0.22522522522490362, y: 2.2747747747747553 }],
                anim: { path: 'bz_id_8', repeat: 5, interval: 1.5, rate: 1, mode: 'normal' },
                anchor: { x: 1260, y: 1010 }
            }, layer_id_1: { ... } }
         */
        const fishTypeConfig = this.app.controllers.fishHunterConfig.getFishTypeConfig(area.gameId);
        // const fishIds = Object.keys(flockConfig);
        // let flockId = _.sample(fishIds);
        let flockId;
        let fishType = null;
        let count = null;

        if (!!sceneData.fishIds && sceneData.fishIds.length > 0) {
            // flockId = _.sample(sceneData.fishIds);
            flockId = sceneId;
        } else if (sceneData.type == 'onBornFish') {
            count = 1;
            fishType = sceneData['fishType'] == '' ? null : sceneData['fishType'];
            flockId = _.sample(Object.keys(flockConfig));
        }

        const res = this._parseFlockData(flockConfig[flockId], fishType, sceneData.paths, flockId, count);

        if (!!res) {
            let fish = null;
            for (let i = 0; i < res.count; i++) {
                fish = yield this._makeFishObject(area, alive, state, i, res.types[i], res.paths[i], fid);
                if (!!fish) {
                    newFishes.push(fish);
                }
            }
        }

        if (newFishes.length > 0) {
            this.insertAreaFish(area._id, newFishes, fishTypeConfig, area.gameId);

            this._sendNotice(area, consts.route.client.game.SPAWN_FISHES, newFishes, count);
        }

        return newFishes;
    } catch (err) {
        logger.error('[fishHunterArea][_spawnFish] area: %s, sceneData: %s, err: ', JSON.stringify(area), JSON.stringify(sceneData), err);
    }
});

proto.fishEventHandler = cort(function* (area, scenes) {
    try {
        const self = this;
        let time = Date.now();
        let config = self.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);
        let changeSceneTimeDelay = area.changeSceneTimeDelay !== null ? area.changeSceneTimeDelay : config.scene.CHANGE_SCENE_TIME_DELAY;
        //计算 这个场景经过多少时间了, = 现在时间 - 上次转场时间
        let diff = time - area.sceneTimer;
        if (config.scene.CHANGE_SCENE_TIME_DELAY != -1 && diff > changeSceneTimeDelay) {
            area.stage = consts.AreaStage.WAIT;
            //切换场景并发送消息
            yield self.onChangeSceneAsync(area);
        } else {
            let scenarioData = self.app.controllers.fishHunterConfig.getFishScenarioConfig(area.gameId);
            /* scenarioData:
             * { 'FS_1-2_o1': { type: 'flock', fishIds: [ 'FS_1-2_o1' ], paths: [] },
             * { 'FS_1-0_o2': { type: 'flock', fishIds: [ 'FS_1-2_o1' ], paths: [] }, ... }
             */
            if (!!scenarioData) { //
                let sceneData = '';
                /* scenes:
                 * [ { "id": "FS_1-1_o1", "time": 0.1, "alive": 25, "fid": 1 },
                 *   { "id": "FS_1-1_o2", "time": 0.11, "alive": 25, "fid": 2 }, ... ]
                 */
                scenes.forEach((scene) => {
                    sceneData = scenarioData[scene.id];
                    /* sceneData: { type: 'flock', fishIds: [ 'FS_1-2_o1' ], paths: [] } */
                    if (!!sceneData) {
                        self._spawnFish(area, scene.alive, sceneData, sceneData.type, scene.fid, scene.id);
                    } else {
                        //logger.error('fishEventHandler no sceneData ', scene);
                    }
                });
            } else {
                //logger.error('fishEventHandler no scenarioData %s', scenarioData);
            }
        }
    } catch (err) {
        logger.error('[fishHunterArea][fishEventHandler] area: %s, scenes: %s, err: ', JSON.stringify(area), JSON.stringify(scenes), err);
    }
});

proto.refreshAreaFrameAsync = cort(function* (area) {
    try {
        let self = this;
        let nowTime = Date.now();
        let config = self.app.controllers.fishHunterConfig.getFishAreaConfig(area.gameId, area.tableLevel, area.scene);

        let flockScenarioConfig = this.app.controllers.fishHunterConfig.getFlockScenarioConfig(area.gameId, area.scene);
        let scenario = flockScenarioConfig.flockScenario;
        // let scenario = config.fish.spawn.flockScenario;

        // 設定檔不存在scenario.scenes 或 設定檔內容長度是0
        if (!scenario.scenes || scenario.scenes.length == 0) return;
        // 冰凍暫停時間
        if (nowTime - area.pauseTime < config.scene.PAUSE_SCREEN_TIME_DELAY) return;

        // 扣除該魚場總共冰凍暫停時間，計算tmEnd時，流程才會是每秒該執行的生魚範圍
        if (area.pauseRange) nowTime -= area.pauseRange;

        let updateTime = _.cloneDeep(area.updateTime);
        area.updateTime = nowTime;                            // 更新area時間

        // 換場
        if (area.stage == consts.AreaStage.WAIT) {
            yield self.onWaitTimerAsync(area);
        }
        // 普通生魚 solo flock bomb chain
        else if (area.stage == consts.AreaStage.NORMAL) {
            let scenes = [];
            // 設定腳本開始時間
            if (area.scenarioTime == 0) {
                area.scenarioTime = updateTime;
            }

            let tmStart = updateTime - area.scenarioTime;
            let tmEnd = nowTime - area.scenarioTime;

            if (tmEnd < 0) return area;

            // let maxTime = 0;
            // for(let s of scenario.scenes) { // 找出fishArea_(level)_(scene): 生最後一隻魚的時間
            //   if(s.time > maxTime) {
            //     maxTime = s.time;
            //   }
            // }
            // maxTime = maxTime * 1000;
            // if(tmStart >= maxTime) {
            //   if(scenario.runMode == 'loop') {
            //     area.scenarioTime = updateTime;
            //   }
            //   // return area;
            // }
            let sceneTime = 0;
            for (let fishAreaScenes of scenario.scenes) {
                sceneTime = fishAreaScenes.time * 1000;
                if (sceneTime > tmStart && sceneTime <= tmEnd) {
                    scenes.push(fishAreaScenes);
                }
            }

            yield self.fishEventHandler(area, scenes);
        } else {
            //logger.error('unknow area stage ', area.stage);
        }
        // area.updateTime = nowTime;                            // 更新area時間
        return area;
    } catch (err) {
        logger.error('[fishHunterArea][refreshAreaFrameAsync] area: %s, err: ', JSON.stringify(area), err);
    }
});
