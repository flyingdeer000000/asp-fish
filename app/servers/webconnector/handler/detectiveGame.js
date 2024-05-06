var quick = require('quick-pomelo');
var P = quick.Promise;
var logger = quick.logger.getLogger('gameserver', __filename);
var C = require('../../../../share/constant');

var Handler = function (app) {
    this.app = app;
    this.questionsBank = [];
    this.gameConfig = {};

    logger.info('detective Game construct ');
    let self = this;
};

module.exports = function (app) {
    return new Handler(app);
};

var proto = Handler.prototype;
var cort = P.coroutine;

// proto.getQuestionBank = cort(function* (msg,session,next) {
//     logger.info('getQuestionBank ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var controller = this.app.controllers.detective;
//     var player = yield controller.findPlayer(accessToken.uid);
//
//     if(player.error){
//         next(null,{code:C.FAILD});
//
//         return;
//     }
//     player = player.data;
//
//     logger.info('player q_cursor ',player.q_cursor);
//     if((this.questionsBank.length > 0) && (player.q_cursor < this.questionsBank.length)) {
//         var ret = this.questionsBank.slice(player.q_cursor,player.q_cursor+10);
//
//         next(null,{code:C.OK,data:ret});
//     }
//     else {
//         next(null,{code:C.OK,data:[]});
//     }
// });
//
// proto.lookAnswer = cort(function* (msg,session,next) {
//     logger.info('lookAnswer ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var controller = this.app.controllers.detective;
//     var params = msg.query || msg.body;
//     var qid = params.qid;
//
//     qid = parseInt(qid);
//
//     var cost = this.gameConfig.lookAnswerCost || 60;
//     var ret = yield controller.lookAnswer(accessToken.uid,qid,cost);
//
//     if(!ret.error){
//         next(null,{code:C.OK,data:{gold: ret.data}});
//
//         return;
//     }
//     else {
//         if(ret.error == C.FISH_AREA_HAS_COMPLETED) {
//             next(null,{code:C.OK,data:{complete:true,gold:ret.data}});
//         }
//         else{
//             next(null,{code:ret.error,data:{gold:ret.data}});
//         }
//     }
// });
//
// proto.commitAnswer = cort(function* (msg,session,next) {
//     logger.info('commitAnswer ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var controller = this.app.controllers.detective;
//     var params = msg.query || msg.body;
//     var qid = params.qid;
//
//     if(this.questionsBank[qid-1] && this.questionsBank[qid-1].ranswers == params.answer){
//         var amount = this.gameConfig.answerRight || 30;
//         var ret = yield controller.answerRight(accessToken.uid, qid, amount);
//
//         if(!ret.error) {
//             ++qid;
//             next(null,{code:C.OK,data:{pass:true,next:qid,gold:ret.data}});
//         }
//         else{
//             if(ret.error == C.FISH_AREA_HAS_COMPLETED) {
//                 next(null,{code:C.OK,data:{pass:true,complete:true,next:qid,gold:ret.data}});
//             }
//             else{
//                 next(null,{code:ret.error,data:{pass:false,next:qid,gold:ret.data}});
//             }
//         }
//     }
//     else {
//         logger.info('answer wrong ');
//         var amount = this.gameConfig.answerWrong || 30;
//         var ret = yield controller.updateGold(accessToken.uid, -amount);
//
//         next(null,{code:C.OK,data:{pass:false,next:qid,gold:ret.data}});
//     }
// });
//
// proto.checkTaskReward = cort(function* (msg,session,next) {
//     logger.info('checkTaskReward ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var controller = this.app.controllers.detective;
//     var params = msg.query || msg.body;
//     var success = params.success;
//
//     if(success) {
//         var amount = this.gameConfig.taskReward || 50;
//         var ret = yield controller.updateGold(accessToken.uid,amount);
//
//         if(!ret.error) {
//             next(null,{code:C.OK,data:{gold:ret.data}});
//         }
//         else{
//             next(null,{code:ret.error,data:{gold:ret.data}});
//         }
//     }
//     else {
//         next(null,{code:C.FAILD,data:{gold:868}});;
//     }
// });
//
//
// proto.getCompleteIds = cort(function* (msg,session,next) {
//     logger.info('getCompleteIds ',msg);
//
//     var accessToken = msg.accessToken;
//
//     if(!accessToken || !accessToken.uid) {
//         next(null,{code:C.ILLEGAL});
//
//         return;
//     }
//
//     var controller = this.app.controllers.detective;
//     var player = yield controller.findPlayer(accessToken.uid);
//
//     if(!player.error){
//         player = player.data;
//         next(null,{code:C.OK,data:player.q_complete});
//     }
//     else {
//         next(null,{code:player.error,data:[]});
//     }
// });
//
// proto.getHistoryQuestion = cort(function* (msg,session,next) {
//     logger.info('getHistoryQuestion ',msg);
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
//     var qid = params.qid;
//
//     if(!qid) {
//         next(null,{code:C.ILLEGAL});
//         return;
//     }
//
//     qid = parseInt(qid);
//
//     var controller = this.app.controllers.detective;
//     var player = yield controller.findPlayer(accessToken.uid);
//
//     if(!player.error){
//         player = player.data;
//         let ret = player.q_complete.indexOf(qid);
//         if(ret == -1 || !this.questionsBank[qid-1]) {
//             next(null,{code:C.FAILD});
//
//             return;
//         }
//
//
//         next(null,{code:C.OK,data:this.questionsBank[qid-1]});
//     }
//     else {
//         next(null,{code:player.error});
//     }
// });
//
// proto.getWorldRank = cort(function* (msg,session,next) {
//     logger.info('getWorldRank ',msg);
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
//     var limit = params.limit || 100;
//
//     limit = parseInt(limit);
//
//     var controller = this.app.controllers.detective;
//     var rank = yield controller.genRankList(limit);
//
//     if(!rank.error){
//
//         next(null,{code:C.OK,data:rank.data});
//     }
//     else {
//         next(null,{code:rank.error});
//     }
// });
