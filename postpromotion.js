const Discordie = require('discordie');
const Events = Discordie.Events;
const client = new Discordie({autoReconnect: true});
const cluster = require('cluster');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const time_ago = require('time_ago_in_words');
 
let db = new sqlite3.Database('posts.db');

db.serialize(function() {
  db.run("CREATE TABLE if not exists posts_info (discordName TEXT, post TEXT, time TEXT, channel_id TEXT)");
});

if (cluster.isMaster) {
    console.log(`Master ${process.pid} is running`);
    for (let i = 0; i < 1; i++) {
        cluster.fork();
    }
    cluster.on('exit', (worker, code, signal) => {
        console.log(`worker ${worker.process.pid} died`);
        cluster.fork();
    });
} else {
    console.log(`Worker ${process.pid} started`);

    var auth = { token: "" };

    client.connect(auth);

    client.Dispatcher.on(Events.GATEWAY_READY, e => {
        console.log('Connected as: ' + client.User.username);
    });

    client.Dispatcher.on(Events.MESSAGE_CREATE, e => {
        if (e.message.author.bot) {
            return;
        }
        const content = e.message.content;
        if(content.indexOf('$last') === 0){
            getUserLastPost(e);
        }else{
            checkPosts(e);
        }
    });

    // Automatically reconnect if the bot disconnects due to inactivity
    client.Dispatcher.on(Events.DISCONNECTED, e => {
        console.log('----- Bot disconnected, Restarting it---');
        client.connect(auth);
    });
}

function getUserLastPost(event){
    db.serialize(function() {
        var selectData = [event.message.author.id];
        db.all("SELECT discordName, post, time, channel_id FROM posts_info WHERE discordName=?",selectData, function(err, allRows) {
            if (err){
                console.log(err);
                event.message.reply('There is some problem in retrieving the Last Details');
            }
            else if(allRows) {
                allRows.sort(function(a,b){
                  return new Date(b.time) - new Date(a.time);
                });
                var lastPost = allRows[0].post;
                var lastPostTime = time_ago(new Date(allRows[0].time) - (1000 * 60));
                event.message.reply('You have last posted ' + lastPostTime);
            }
        });
    })
}

function checkPosts(event) {

    var url = event.message.content.match(/\bhttps?:\/\/\S+/gi);
    // Check if the URL is null or not
    if(url === null) {
        return;
    }
    console.log(url);
    let isPostValid = !!url[0].match(
        /^(http:\/\/www\.|https:\/\/www\.|http:\/\/|https:\/\/)?[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,5}(:[0-9]{1,5})?(\/.*)?$/g
    );
    console.log(isPostValid);

    if (isPostValid) {
        isUserAddedPost(event)
            .then(function(allRows) {
                if(allRows != null && allRows.length > 0) {
                    var postValue = event.message.content;
                    if(event.message.content.indexOf('@') !== -1){
                        postValue = event.message.content.split('@')[1].split('/')[1];
                    }
                    var currentCreatedTimestamp = event.message.edited_timestamp || event.message.timestamp;

                    var count = 0;
                    allRows.forEach(function (row){
                        if(row.post === postValue) {
                            count++;
                        }
                    });
                    if(count >= 2) {
                        event.message.reply('One link can be posted max 2 times across channels, you have already shared this post 2 times your post is deleted');
                        event.message.delete();
                        throw new Error("Exit");
                        return null;
                    }
                    var linkPostedin24Hours = 0;
                    var d1 = new Date(currentCreatedTimestamp);
                    allRows.forEach(function (row){
                        var d2 = new Date(row.time);
                        var timeDiff = Math.abs(d1 - d2) / 36e5;
                        if(timeDiff < 24) {
                            linkPostedin24Hours++;
                        }
                    });
                    if(linkPostedin24Hours > 2) {
                        event.message.reply('You can post max 2 links in 24 hours hence your post is deleted');
                        event.message.delete();
                        throw new Error("Exit");
                        return null;
                    }

                    let obj = allRows.find(o => o.post === postValue && o.channel_id === event.message.channel_id);
                    if(obj) {
                        event.message.reply('You have Already Shared the Post before in this channel, your post is deleted');
                        event.message.delete();
                        throw new Error("Exit");
                        return null;
                    } else {
                        db.serialize(function() {
                            var data = [event.message.author.id,postValue,currentCreatedTimestamp,event.message.channel_id];
                            db.run("INSERT into posts_info(discordName,post,time,channel_id) VALUES (?,?,?,?)",data);
                        });
                    }
                }
                else {
                    var postValue = event.message.content.split('@')[1].split('/')[1];
                    let currentCreatedTimestamp = event.message.edited_timestamp || event.message.timestamp;
                    json = JSON.stringify({discordName: event.message.author.id, post: postValue, time: currentCreatedTimestamp});
                    console.log(json);
                    db.serialize(function() {
                        var data = [event.message.author.id,postValue,currentCreatedTimestamp,event.message.channel_id];
                        db.run("INSERT into posts_info(discordName,post,time,channel_id) VALUES (?,?,?,?)",data);
                    });
                }
            }).catch(function (e) {
                console.log(e);
            });
    }
}

function isUserAddedPost(event){
 return new Promise(function(yes, no) {
    console.log(db);
    db.serialize(function() {
        var selectData = [event.message.author.id, event.message.channel_id];
        db.get("SELECT discordName, post, time, channel_id FROM posts_info WHERE discordName=? AND channel_id=?",selectData, function(err, row) {
            if (err){
                console.log(err);
                no(err);
            }
            else {
                if(row) {
                    console.log(row);
                    var item = {
                        discordName: row.discordName,
                        post: row.post,
                        time: row.time,
                        channel_id: row.channel_id
                    }
                    yes(item);
                }
                yes(null);
            }
        });
    });
 });
}
