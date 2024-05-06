let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('connector', __filename);

let Controller = function (app) {
    this.app = app;
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;

proto._getConfig = function (id, name) {
    try {
        let configs = this.app.get('jsonLoader');
        if (!configs) {
            return null;
        }
        return configs.getData(id, name);
    } catch (err) {
        logger.error('[fishHunterConfig][_getConfig] id: %s, err: ', id, err);
    }
}

proto.getRoomConfig = function (id) {
    try {
        return this._getConfig(id, 'room');
    } catch (err) {
        logger.error('[fishHunterConfig][getRoomConfig] id: %s, err: ', id, err);
    }
}

proto.getGameConfig = function (id, level) {
    try {
        return this._getConfig(id, 'fishHunter_' + level);
    } catch (err) {
        logger.error('[fishHunterConfig][getGameConfig] id: %s, level: %s, err: ', id, level, err);
    }
}

proto.getFishAlgSummaryConfig = function (id, type) {
    try {
        let config = this._getConfig(id, 'fishAlgorithm');
        if (!config) {
            return null;
        }

        config = config[type];
        if (!config) {
            return null;
        }

        return config;
    } catch (err) {
        logger.error('[fishHunterConfig][getFishAlgSummaryConfig] gameId: %s, type: %s, err: ', id, type, err);
    }
}
proto.getFishAlgConfig = function (id) {
    try {
        let config = this._getConfig(id, 'fishAlgorithm');
        if (!config) {
            return null;
        }

        return config;
    } catch (err) {
        logger.error('[fishHunterConfig][getFishAlgConfig] gameId: %s, type: %s, err: ', id, type, err);
    }
}

proto.getFishPathConfig = function (id) {
    try {
        return this._getConfig(id, 'path');
    } catch (err) {
        logger.error('[fishHunterConfig][getFishPathConfig] gameId: %s, err: ', id, err);
    }
}

proto.getFishFlockConfig = function (id) {
    try {
        return this._getConfig(id, 'fishFlockScenario');
    } catch (err) {
        logger.error('[fishHunterConfig][getFishFlockConfig] gameId: %s, err: ', id, err);
    }
}

proto.getFishScenarioConfig = function (id) {
    try {
        return this._getConfig(id, 'fishScenario');
    } catch (err) {
        logger.error('[fishHunterConfig][getFishScenarioConfig] gameId: %s, err: ', id, err);
    }
}

proto.getFishServerConfig = function (id) {
    try {
        return this._getConfig(id, 'serverCnf');
    } catch (err) {
        logger.error('[fishHunterConfig][getFishServerConfig] err: ', err);
    }
}

proto.getRCServerConfig = function (id) {
    try {
        return this._getConfig(id, 'rcServerConfig');
    } catch (err) {
        logger.error('[fishHunterConfig][getRCServerConfig] err: ', err);
    }
}

proto.getFishAreaConfig = function (id, level, scene) {
    try {
        let name = 'fishArea_' + level + '_' + scene;
        return this._getConfig(id, name);
    } catch (err) {
        logger.error('[fishHunterConfig][getFishAreaConfig] id: %s, level: %s, scene: %s, err: ', id, level, scene, err);
    }
}

proto.getSSOConfig = function (id) {
    try {
        return this._getConfig(id, 'SSOConfig');
    } catch (err) {
        logger.error('[fishHunterConfig][getSSOConfig] err: ', err);
    }
}

proto.getTreasureConfig = function (id) {
    try {
        return this._getConfig(id, 'treasureConf');
    } catch (err) {
        logger.error('[fishHunterConfig][getTreasureConfig] err: ', err);
    }
}

proto.getBonusConfig = function (id) {
    try {
        return this._getConfig(id, 'bonusConf');
    } catch (err) {
        logger.error('[fishHunterConfig][getBonusConfig] err: ', err);
    }
}

proto.getCommonConfig = function (id) {
    try {
        return this._getConfig(id, 'commonConf');
    } catch (err) {
        logger.error('[fishHunterConfig][getCommonConfig] err: ', err);
    }
}

proto.getParamDefinConfig = function (id) {
    try {
        return this._getConfig(id, 'paramDefinConf');
    } catch (err) {
        logger.error('[fishHunterConfig][getParamDefinConfig] err: ', err);
    }
}

// proto.getFishChainBombConfig = function (id) {
//   try {
//     return this._getConfig(id,'fishChainBombScenario');
//   } catch (err) {
//     logger.error('[fishHunterConfig][getFishChainBombConfig] err: ', err);
//   }
// }

// proto.getCurrencyConfig = function (id) {
//   try {
//     return this._getConfig(id,'currencyConf');
//   } catch (err) {
//     logger.error('[fishHunterConfig][getCurrencyConfig] err: ', err);
//   }
// }
// proto.getCurrencyConfigByDC = function (dc, id) {
//   try {
//     return this._getConfig(id,'currencyConf_' + dc);
//   } catch (err) {
//     logger.error('[fishHunterConfig][getCurrencyConfigByDC] err: ', err);
//   }
// }

proto.getRequestDefConfig = function (id) {
    try {
        return this._getConfig(id, 'requestDefCnf');
    } catch (err) {
        logger.error('[fishHunterConfig][getRequestDefConfig] err: ', err);
    }
}

proto.getCollectionDrawConfig = function (id) {
    try {
        return this._getConfig(id, 'collectionDraw');
    } catch (err) {
        logger.error('[fishHunterConfig][getCollectionDrawConfig] err: ', err);
    }
}

proto.getFlockScenarioConfig = function (id, scene) {
    try {
        let name = 'flockScenario_' + scene;
        return this._getConfig(id, name);
    } catch (err) {
        logger.error('[fishHunterConfig][getFlockScenarioConfig] id: %s, scene: %s, err: ', id, scene, err);
    }
}

proto.getFishScoreConfig = function (id) {
    try {
        return this._getConfig(id, 'fishScore');
    } catch (err) {
        logger.error('[fishHunterConfig][getFishScoreConfig] id: %s, err: ', id, err);
    }
}

proto.getWeaponAliveAlgConfig = function (id) {
    try {
        return this._getConfig(id, 'weaponAliveAlg');
    } catch (err) {
        logger.error('[fishHunterConfig][getWeaponAliveAlgConfig] id: %s, err: ', id, err);
    }
}

proto.getChainAlgConfig = function (id) {
    try {
        return this._getConfig(id, 'chainAlgorithm');
    } catch (err) {
        logger.error('[fishHunterConfig][getChainAlgConfig] id: %s, err: ', id, err);
    }
}

proto.getCostAlgConfig = function (id) {
    try {
        return this._getConfig(id, 'costAlgorithm');
    } catch (err) {
        logger.error('[fishHunterConfig][getCostAlgConfig] id: %s, err: ', id, err);
    }
}

proto.getFishTypeConfig = function (id) {
    try {
        return this._getConfig(id, 'fishType');
    } catch (err) {
        logger.error('[fishHunterConfig][getFishTypeConfig] id: %s, err: ', id, err);
    }
}

proto.getExtraBonusAlgConfig = function (id) {
    try {
        return this._getConfig(id, 'extraBonusAlg');
    } catch (err) {
        logger.error('[fishHunterConfig][getExtraBonusAlgConfig] id: %s, err: ', id, err);
    }
}
