'use strict';
let quick = require('quick-pomelo');
let P = quick.Promise;
let consts = require('../../share/consts');
let logger = quick.logger.getLogger('connector', __filename);
let utils = require('../utils/utils');

let Controller = function (app) {
    this.app = app;
    this.webConnectorCls = this.app.get('WebConnectorCls');
};

module.exports = function (app) {
    return new Controller(app);
};

let proto = Controller.prototype;
let cort = P.coroutine;

// proto.addLog = cort(function* (target_logData) {
//     let self = this;
//     new Promise((resolve, reject) => {
//
//         let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
//         let url = config.webConnectorUrl;
//         let data = {};
//         data = {
//             Cid:                target_logData.playerId,
//             GameId:             target_logData.gameId,
//             IP:                 target_logData.ip,
//             Date:               target_logData.createTime || Date.now(),
//             LType:              target_logData.logType || consts.LogType.IN,
//             LDesc:              target_logData.logDesc || consts.PlayerStateDesc.LOG_IN,
//             isMobile:           target_logData.isMobile,
//             os:                 target_logData.os,
//             os_version:         target_logData.osVersion,
//             browser:            target_logData.browser,
//             browser_version:     target_logData.browserVersion,
//         };
//         data.Date = utils.timeConvert(data.Date);
//         //丟API Server寫登入登出資訊至 MySQL
//         let opts = {
//             method:       consts.GSBridgeMethod.addLogPlayerLoginout,
//             platform:     consts.APIServerPlatform.gsBridge,
//             data:         data,
//         };
//         logger.info('[log][addLog][CallAPI] addLogPlayerLoginout ：', opts);
//         return utils.httpPost(url, opts);
//     }).then(httpRes => {
//         if (httpRes.status != statusCode.SUCCESS)
//             logger.error('[log][addLog][RES] addLogPlayerLoginout_FAIL ：', JSON.stringify(httpRes));
//     }).catch((err) => {
//         logger.error('[log][addLog] target_logData: %s, err: ', JSON.stringify(target_logData), err);
//     })
// });

proto.addLog = function (target_logData) {
    let self = this;
    try {
        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        let data = {
            Cid: target_logData.playerId,
            GameId: target_logData.gameId,
            IP: target_logData.ip,
            Date: target_logData.createTime || Date.now(),
            LType: target_logData.logType || consts.LogType.IN,
            LDesc: target_logData.logDesc || consts.PlayerStateDesc.LOG_IN,
            isMobile: target_logData.isMobile,
            os: target_logData.os,
            os_version: target_logData.osVersion,
            browser: target_logData.browser,
            browser_version: target_logData.browserVersion,
        };
        data.Date = utils.timeConvert(data.Date);
        //丟API Server寫登入登出資訊至 MySQL
        let opts = {
            method: consts.GSBridgeMethod.addLogPlayerLoginout,
            platform: consts.APIServerPlatform.gsBridge,
            data: data,
        };
        logger.info('[log][addLog][CallAPI] addLogPlayerLoginout ：', opts);
        utils.httpPost(url, opts);
    } catch (err) {
        logger.error('[log][addLog] target_logData: %s, err: ', JSON.stringify(target_logData), err);
    }
};

proto.addServerActionLog = function (type, player, action, serverId, logData) {
    let self = this;
    try {
        let data = {
            Cid: player._id,
            UserName: player.userName,
            ActionServer: serverId,
            Action: action,
            GameId: player.gameId,
            Desc_Before: '',
            Desc_After: '',
        };
        let desc_after = {};

        switch (type) {
            case consts.APIMethod.bet:
                data['Desc_After'] = JSON.stringify({
                    areaId: player.areaId,
                    bulletId: logData['bullet'].bulletId,
                    shootType: logData['bullet']['level'] || 'normal',
                    bet: logData['bullet'].cost,
                });
                break;
            case consts.APIMethod.win:
            // desc_after['colliderTime'] = utils.timeConvert(Date.now());
            case consts.APIMethod.betAndWin:
                desc_after['areaId'] = player.areaId;
                desc_after['win'] = logData['gain'];

                if (logData['bet']) {
                    desc_after['bet'] = logData['bet'];
                }

                if (logData['bullet']) {
                    desc_after['bulletId'] = logData['bullet'].bulletId;
                    desc_after['shootType'] = logData['bullet'].shootType;
                }

                if (logData['fishInfo']) {
                    desc_after['fishType'] = logData['fishInfo'].fishRealType;
                    desc_after['killFishes'] = logData['fishInfo'].die;
                    desc_after['fishIds'] = logData['fishInfo'].fids.toString();
                }
                data['Desc_After'] = JSON.stringify(desc_after);
                break;
        }
        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        let url = config.webConnectorUrl;
        // 丟 API Server 寫 Server 執行的 Log 資訊至 MySQL
        let opts = {
            method: consts.GSBridgeMethod.addServerActionLog,
            platform: consts.APIServerPlatform.gsBridge,
            data: data,
        };
        logger.info('[log][addServerActionLog][CallAPI] addServerActionLog ：', opts);
        utils.httpPost(url, opts);
    } catch (err) {
        logger.error('[log][addServerActionLog] logData: %s, err: ', JSON.stringify(logData), err);
    }
};
