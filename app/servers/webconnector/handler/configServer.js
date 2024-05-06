var quick = require('quick-pomelo');
var logger = quick.logger.getLogger('gameserver', __filename);
var C = require('../../../../share/constant');
const fs = require('fs');
var _ = require('lodash');

var Handler = function (app) {
    this.app = app;
    this.shareConfig = [];

    logger.info('detective Game construct ');
    let self = this;
    // this.app.controllers.detective.requireAndWatch('/statics/shareConfig.js',function (res) {
    //     self.shareConfig = res;

    //     logger.info('shareConfig ',self.shareConfig);
    // });

    this.dieProbabilityData = null;
    this.isCalcPending = false;
    this.exceptProbabilityData = null;
};

module.exports = function (app) {
    return new Handler(app);
};

var proto = Handler.prototype;

// proto.getShareConfig = function (msg,session,next) {
//     logger.info('getShareConfig ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var params = msg.query || msg.body;
//     var appId =params.appId;
//
//     if(appId) {
//         var config = this.shareConfig[appId];
//
//         if(config) {
//             next(null,{code:C.OK,data:config.share});
//         }
//         else{
//             next(null,{code:C.ERROR});
//         }
//     }
//     else{
//         next(null,{code:C.ERROR});
//     }
// }

// proto.getHelpMode = function (msg,session,next) {
//     logger.info('getHelpMode ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var params = msg.query || msg.body;
//     var appId =params.appId;
//
//     if(appId) {
//         var config = this.shareConfig[appId];
//
//         if(config) {
//             next(null,{code:C.OK,data:config.helpMode});
//         }
//         else{
//             next(null,{code:C.ERROR});
//         }
//     }
//     else{
//         next(null,{code:C.ERROR});
//     }
// }

// proto.navigateReport = function (msg,session,next) {
//     logger.info('navigateReport ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var params = msg.query || msg.body;
//
//     next(null,{code:C.OK});
// }

// proto.getNavigateConfig = function (msg,session,next) {
//     logger.info('getNavigateConfig ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var params = msg.query || msg.body;
//     var appId =params.appId;
//
//     if(appId) {
//         var config = this.shareConfig[appId];
//
//         if(config) {
//             next(null,{code:C.OK,data:config.navigate});
//         }
//         else{
//             next(null,{code:C.ERROR});
//         }
//     }
//     else{
//         next(null,{code:C.ERROR});
//     }
// }

// proto.getDieProbability = function (msg,session,next) {
//     logger.info('getDieProbability ',msg);
//
//     // var accessToken = msg.accessToken;
//     //
//     // if(!accessToken || !accessToken.uid) {
//     //     next(null,{code:C.ILLEGAL});
//     //
//     //     return;
//     // }
//
//     var params = msg.query || msg.body;
//     var appId =params.appId;
//
//     var control = this.app.controllers.fishHunterGame;
//     var labels = [];
//     var result = [];
//
//     if(this.isCalcPending){
//         return next(null,{code:C.FAILD});
//     }
//
//     var config = {
//         "probability": {
//             "factor": 1.15,
//             "level": 3
//         }
//     }
//     params.factor = params.factor || 1.15;
//     config.probability.factor = params.factor || 1.15;
//
//     if(this.dieProbabilityData  && this.dieProbabilityData.factor == params.factor){
//         next(null,{code:C.OK,data:this.dieProbabilityData});
//         this.dieProbabilityData = null;
//
//         return;
//     }
//     else{
//         this.dieProbabilityData = null;
//     }
//
//     var startTime = Date.now();
//     this.isCalcPending = true;
//
//     for(var i=1; i<301; i++){
//         var dieCount = 0;
//
//         for(var j=0; j<100; j++){
//
//             var monster = control.SPMonster(i,config);
//             var roomMaxCost = 1000;
//             var ret = control.RMSystem(roomMaxCost, monster, control.PlayerLevel);
//
//             var die = (ret > 0);
//
//             if(die){
//                 ++dieCount
//             }
//         }
//
//         labels.push(i);
//         result.push(dieCount);
//     }
//
//     logger.info('spend ',Date.now() - startTime);
//     logger.info('result ',result);
//
//     this.dieProbabilityData = {labels:labels,result:result,factor:config.probability.factor};
//     this.isCalcPending = false;
//
//     next(null,{code:C.OK,data:this.dieProbabilityData});
// }

// proto.getExpectProbability = function (msg,session,next) {
//     logger.info('getExpectProbability ',msg);
//
//     var params = msg.query || msg.body;
//     var appId =params.appId;
//
//     var control = this.app.controllers.fishHunterGame;
//     var labels = [];
//     var minResult = [];
//     var maxResult = [];
//     var avgResult = [];
//
//     if(this.isCalcPending){
//         return next(null,{code:C.FAILD});
//     }
//
//     var config = {
//         "probability": {
//             "factor": 1.15,
//             "level": 3
//         }
//     }
//
//     params.factor = params.factor || 1.15;
//     config.probability.factor = params.factor || 1.15;
//
//     if(this.exceptProbabilityData && this.exceptProbabilityData.factor == params.factor){
//         next(null,{code:C.OK,data:this.exceptProbabilityData});
//         this.exceptProbabilityData = null;
//
//         return;
//     }
//     else{
//         this.exceptProbabilityData = null;
//     }
//
//     var startTime = Date.now();
//     this.isCalcPending = true;
//
//     for(var i=1; i<301; i++){
//         var monster = control.SPMonster(i,config);
//
//         var arrayMax = monster.RT;
//         var arrayAT = monster.FirstNT;
//         var arrayBT = monster.SecondNT;
//         var arrayCT = monster.ThirdNT;
//
//         var pMin = (arrayAT / arrayMax) * (arrayBT / arrayMax) * (arrayCT / arrayMax) * 100;
//         var pAvg = pMin * 3;
//         var pMax = pMin * 5;
//
//         minResult.push(pMin);
//         avgResult.push(pAvg);
//         maxResult.push(pMax);
//         labels.push(i);
//     }
//
//     logger.info('spend ',Date.now() - startTime);
//     logger.info('minResult ',minResult,' maxResult ',maxResult);
//
//     this.exceptProbabilityData = {
//         factor:config.probability.factor,
//         labels:labels,
//         minResult:minResult,
//         avgResult:avgResult,
//         maxResult:maxResult
//     };
//     this.isCalcPending = false;
//
//     next(null,{code:C.OK,data:this.exceptProbabilityData});
// }
//
// proto.updateConfigFile = function (msg,session,next) {
//     logger.info('updateConfigFile ',msg);
//
//     var params = msg.query || msg.body;
//
//     var config = this.app.controllers.fishHunterConfig.getGameConfig(params.gameId);
//     config = config.configFile;
//
//     var filePath = config[params.fileName];
//     if(!filePath){
//         return next(null,{code:C.ERROR});
//     }
//
//     if(params.method == 'set'){
//         logger.info('writeConfigFile ',filePath,' data ',params.data);
//
//         var data = Buffer.from(params.data);
//
//         if(params.fileName == 'fishServerConfig'){
//             var cnf = this.app.controllers.fishHunterConfig.getGameConfig(params.gameId);
//             var obj = JSON.parse(params.data);
//             cnf.scene = obj.scene;
//
//             data = Buffer.from(JSON.stringify(cnf));
//         }
//
//         if(_.isArray(filePath)){
//             filePath.forEach((value,index,arr) => {
//                 fs.writeFileSync(value,data);
//             });
//         }
//         else if(_.isString(filePath)){
//             fs.writeFileSync(filePath,data);
//         }
//
//         next(null,{code:C.OK});
//     }
//     else{
//         var data ='{}';
//         var f = '';
//
//         if(_.isArray(filePath)){
//             if(filePath.length > 0){
//                 f = filePath[0];
//             }
//
//         }
//         else if(_.isString(filePath)){
//             f = filePath;
//         }
//
//         if(f == ''){
//             return next(null,{code:C.ERROR});
//         }
//
//         if(params.fileName == 'fishServerConfig'){
//             var cnf = this.app.controllers.fishHunterConfig.getGameConfig(params.gameId);
//             data = {scene:cnf.scene};
//         }
//         else{
//             if(fs.existsSync(f))
//             {
//                 data = fs.readFileSync(f,'utf8');
//             }
//             logger.info('readConfigFile ',f,' data ',data);
//
//             data = JSON.parse(data);
//         }
//
//         next(null,{code:C.OK,data:data});
//     }
// }
