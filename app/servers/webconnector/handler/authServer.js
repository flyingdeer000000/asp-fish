var quick = require('quick-pomelo');
var P = quick.Promise;
var logger = quick.logger.getLogger('connector', __filename);
var C = require('../../../../share/constant');

// var wxApi = require('../../../wxUtils/wxApi');

var Handler = function (app) {
    this.app = app;
    this.webConnectorCls = this.app.get('WebConnectorCls');
};

module.exports = function (app) {
    return new Handler(app);
};

var proto = Handler.prototype;
var cort = P.coroutine

// proto.auth = function (msg,session,next) {
//     logger.info("sayHello ",msg);
//
//     var token =this.webConnectorCls.jwtGenToken({uid:'fs2hero'})
//     next(null,{code:C.OK,token:token});
// }
//
// proto.timeout = function (msg,session,next) {
//     logger.info('authServer.timeout ');
// }

// proto.wechatLogin = cort(function* (msg,session,next) {
//
//     const appId = 'wxf3d4261eb22ce92c';
//     const appSecret = '43ba02717fbc0c60a7b178da4697e24c';
//     const self = this;
//
//     logger.info('wechatLogin ',msg);
//
//     try {
//         const reqParams = msg.params || {};
//         const reqOpenId = msg.query.openid || msg.body.openid || reqParams.openid;
//         var sKey ='';
//         var controller = this.app.controllers.detective;
//         var decData = null;
//
//         if(reqOpenId) {
//             var ret = yield controller.getWxSessionKey(reqOpenId);
//
//             if(!ret.error && ret.data && ret.data.session_key){
//                 sKey = ret.data.session_key;
//             }
//         }
//
//         if(reqOpenId && sKey) {
//             logger.info('use memory sessionKey ',sKey);
//
//             wxApi.checkSigAndDecipherer(msg,sKey,appId)
//                 .then(data => {
//                     decData = data;
//                     return controller.createPlayer(data.userInfo,sKey);
//                 })
//                 .then(data => {
//                     if(data.error || !data.data){
//                         throw 'create Player error 1';
//                     }
//                     else{
//                         decData.gold = data.data.gold;
//                         return decData;
//                     }
//                 })
//                 .then(data => {
//                     var token =this.webConnectorCls.jwtGenToken({uid:data.userInfo.openId},{expiresIn:86400})
//
//                     logger.info('userInfo ',data,' token ',token);
//                     data.userInfo.token = token;
//                     data.userInfo.gold = data.gold;
//
//                     next(null,{code:C.OK,data:data.userInfo});
//                 })
//                 .catch((err) => {
//                     logger.error('reject err ',err);
//                     controller.delWxSessionKey(reqOpenId);
//
//                     next(null,{code:C.ERROR});
//                 })
//         }
//         else{
//             logger.info('request sessionKey ');
//
//             wxApi.getSessionKeyAndDecipherer(appId,appSecret,msg)
//                 .then(data => {
//                     decData = data;
//                     return controller.createPlayer(data.userInfo,data.sessionKey);
//                 })
//                 .then(data => {
//                     if(data.error || !data.data){
//                         throw 'create Player error 2';
//                     }
//                     else{
//                         decData.gold = data.data.gold;
//                         return decData;
//                     }
//                 })
//                 .then(data => {
//                     var token =this.webConnectorCls.jwtGenToken({uid:data.userInfo.openId},{expiresIn:86400})
//
//                     logger.info('userInfo ',data,' token ',token);
//                     data.userInfo.token = token;
//                     data.userInfo.gold = data.gold;
//
//                     next(null,{code:C.OK,data:data.userInfo})
//                 })
//                 .catch((err) => {
//                     logger.error('reject err ',err);
//                     next(null,{code:C.ERROR})
//                 })
//         }
//     }
//     catch (err) {
//         logger.error('catch err ',err);
//         next(null,{code:C.ERROR})
//     }
// });
