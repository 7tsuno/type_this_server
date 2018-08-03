const http = require('http');
const https = require('https');
const cheerio = require('cheerio');
const socketio = require('socket.io');
const fs = require('fs');

const server = http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html'
  });
  res.end('server connected');
}).listen(3000);

const io = socketio.listen(server);

const googleTrendUrl = 'https://trends.google.co.jp/trends/hottrends/atom/hourly?pn=p4';

let questionsMaster = [];

https.get(googleTrendUrl, function(res) {
  let body = '';
  res.setEncoding('utf8');
  res.on('data', function(chunk) {
    body += chunk;
  });
  res.on('data', function(chunk) {
    let $ = cheerio.load(body);
    $(".new").each(function() {
      let link = $(this);
      let text = link.text();
      if (text) {
        questionsMaster.push(text);
      }
    });
    questionsMaster = questionsMaster.filter((x, i, self) => self.indexOf(x) === i);
  })
}).on('error', function(e) {
  console.log(e.message);
});

let state = {
  users: {},
  maxMatchCount: 5,
  matchCount: 0,
  question: {
    text: '',
    answerUsers: []
  },
  loading: false
};

let timeoutID;

let questions = [];

const createQuestions = () => {
  let ary = questionsMaster.concat();
  var i = ary.length;
  while (i) {
    var j = Math.floor(Math.random() * i);
    var t = ary[--i];
    ary[i] = ary[j];
    ary[j] = t;
  }
  questions = ary.slice(0, 5);
}

const getQuestionText = () => {
  return questions[state.matchCount];
};

io.sockets.on('connection', socket => {

  // サーバー⇒クライアントの同期処理
  const syncToLocal = () => {
    io.sockets.emit('sync', {
      users: state.users,
      maxMatchCount: state.maxMatchCount,
      matchCount: state.matchCount,
      question: state.question,
      loading:state.loading
    });
  };

  // 問題表示
  const nextQuestion = () => {

    Object.keys(state.users).map(key => {
      state.users[key].input = '';
    })

    clearTimeout(timeoutID);

    // 全問終了時
    if (state.matchCount == state.maxMatchCount) {

      // 5秒後に結果を返却。
      setTimeout(() => {
        console.log('結果画面表示');
        syncToLocal();
      }, 3000);
    } else {

      // 3秒後に問題を返却。
      setTimeout(() => {
        state.loading = true;
        syncToLocal();
        setTimeout(() => {
          console.log((state.matchCount + 1) + '問めの問題を開始');
          state.loading = false;
          state.question = {
            text: getQuestionText(),
            answerUsers: []
          };
          syncToLocal();

          // 30秒で次の問題に移動。
          timeoutID = setTimeout(() => {
            state.matchCount++;
            nextQuestion();
          }, 30000)

        }, 3000);
      }, 3000)
    }
  };

  syncToLocal();

  // ログイン
  socket.on('login_send', data => {

    if (Object.keys(state.users).length < 4) {
      state.users[socket.id] = {
        name: data.name,
        point: 0
      };
      syncToLocal();
      console.log(state.users[socket.id], 'がログイン');

      // 4人集まった場合、最初の問題を提示する。
      if (Object.keys(state.users).length == 4) {
        clearTimeout(timeoutID);
        state.loading = true;
        syncToLocal();
        createQuestions();
        nextQuestion();
      }
    }
  });

  // タイピング受信
  socket.on('type_send', (data) => {
    state.users[socket.id].input = data.input;
    syncToLocal();
  });

  // 回答受信
  socket.on('answer_send', () => {

    state.question.answerUsers.push(state.users[socket.id].name);

    if (state.question.answerUsers.length == 1) {
      state.users[socket.id].point = state.users[socket.id].point + 5;
    }
    if (state.question.answerUsers.length == 2) {
      state.users[socket.id].point = state.users[socket.id].point + 3;
    }
    if (state.question.answerUsers.length == 3) {
      state.users[socket.id].point = state.users[socket.id].point + 1;
    }

    syncToLocal();

    if (state.question.answerUsers.length == 3) {
      state.matchCount++;
      nextQuestion();
    }
  });

  // 接続切れ
  socket.on('disconnect', data => {

    if (state.users[socket.id]) {
      console.log(state.users[socket.id], 'がログアウト');
      delete state.users[socket.id];
      if (Object.keys(state.users).length == 0) {
        clearTimeout(timeoutID);
        console.log('終了');
        state = {
          users: {},
          maxMatchCount: 5,
          matchCount: 0,
          question: {
            text: '',
            answerUsers: []
          }
        }
      }
    }

  });

});
