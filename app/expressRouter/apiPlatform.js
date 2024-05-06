let _ = require('lodash');
let quick = require('quick-pomelo');
let P = quick.Promise;
let logger = quick.logger.getLogger('apiPlatform', __filename);
let Router = require('express').Router;
const apiCode = require('./apiServerStatus');
let utils = require('../utils/utils');
let consts = require('../../share/consts');

//Express Router Construct
let ExpRouter = function (app) {
    let router = Router();
    let self = ExpRouter;
    self.app = app;

    //Bind Data
    router.use(self.paramsParseMiddleware.bind(self));
    router.post('/', self.dispatch.bind(self));
    router.get('/', self.dispatch.bind(self));
    return router;
}

let statics = ExpRouter;
// let cort = P.coroutine;

module.exports = function (app) {
    return ExpRouter(app);
}

//Parser URL Data function
statics.paramsParseMiddleware = function (req, res, next) {

    //確認參數是否存在
    let params = (!_.isEmpty(req.body) && req.body) || (!_.isEmpty(req.query) && req.query);
    logger.info('[apiPlatform][paramsParseMiddleware] Params = ', JSON.stringify(params));

    if (!params)
        throw ('params = ' + params);

    try {
        req.action = params;
        if (!!next) {
            next();
        }
    } catch (err) {
        res.send({status: apiCode.FAILED, err: err});
        res.end();
        return;
    }
}

statics.dispatch = function (req, res) {
    logger.info('[INFO][API][dispatch] Method : ', req.action.method);
    let params = req.action;
    let self = this;
    let router;

    switch (params.platform) {
        case consts.APIServerPlatform.gs:
            self.sendAPI(req, res);
            break;
        case consts.APIServerPlatform.api:
            router = 'whiteLabel';
            self._toAPIServer(router, req, res);
            break;
        case consts.APIServerPlatform.gsBridge:
            router = 'gsBridge';
            self._toAPIServer(router, req, res);
            break;

        // ex:
        // case 'others':
        //   self._toAPIServer(req, res);
        //   break;
        default:
            res.send({status: apiCode.UNKNOW_ACTION, err_text: ' authenticate unsupport platform'});
            res.end();
            break
    }
}

statics._toAPIServer = function (router, req, res) {
    let config = this.app.controllers.fishHunterConfig.getFishServerConfig();
    let url = config.apiServerUrl + router;
    let params = req.action;

    utils.httpPost(url, params)
        .then(data => {
            logger.info(`[apiPlatform][_toAPIServer] SUCCESS data: `, data)
            res.send({status: apiCode.SUCCESS, data: data});
            res.end();
        })
        .catch(err => {
            logger.warn(`[apiPlatform][_toAPIServer][catch] err: `, err)
            res.send({status: apiCode.FAILED, err_text: err});
            res.end();
        })
}

statics.sendAPI = function (req, res) {
    try {
        logger.info('[apiPlatform][sendAPI] req.action = ', req.action);

        let self = this;
        let method = req.action.method;
        switch (method) {
            case consts.APIMethod.lineSelection:     //玩家進入GS資料驗證
                self.lineSelection(req, res);
                break;

            default:
                logger.error('[apiPlatform][sendAPI] method = ', 'unknown method');
                res.send({status: apiCode.UNKNOW_ACTION, err_text: 'unknown method'});
                res.end();
                break;
        }
    } catch (err) {
        logger.error('[apiPlatform][sendAPI][catch] err = ', JSON.stringify(err));
    }
}

statics.lineSelection = function (req, res) {
    try {
        logger.info('[apiPlatform][lineSelection] req.action = ', req.action);
        let self = this;
        let gameId = req.action.gameId;

        let config = self.app.controllers.fishHunterConfig.getFishServerConfig();
        config = config.fishGameId;

        if (config.indexOf(gameId) == -1) {
            // failed
            logger.warn('[apiPlatform][lineSelection] return by Game %s Not Exist.', gameId);
            res.send({status: apiCode.FAILED, err_text: `Game ${gameId} Not Exist`});
            res.end();
        } else {
            // success
            let date = {
                status: apiCode.SUCCESS
            }
            //回傳玩家資訊
            res.send(date);
            res.end();
        }
    } catch (err) {
        logger.error('[apiPlatform][lineSelection][catch] err = ', err);
        res.send({status: apiCode.FAILED, err_text: err});
        res.end();
    }
}
