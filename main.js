var ws = require('ws'),
	path = require('path'),
	fs = require('fs'),
	async = require('async'),
	GitWatch = require('./lib/git-watch'),
	EventEmitter = require('events').EventEmitter;

var config = require('./config');

var exclude = [ 'build', 'bin', 'classes', 'src', 'photos' ];

var repos = {};

// Find the damn repos
function traverse(basedir, dir, prefix, callback) {
	fs.readdir(path.join(basedir, dir), function(err, files) {
		if(err) { callback(null, []); return; } // ignore
		if(files.indexOf('HEAD') != -1 && files.indexOf('config') != -1) {
			var base = dir.replace(/\/?\.git$/, '');
			var repoName = path.join(prefix, base);
			console.log('Found repo: ' + repoName);
			repos[repoName] = new GitWatch(path.join(basedir, dir));
			numRepos++;
			repos[repoName].addListener('open', function() {
				numOpened++;
				if(finished && numRepos == numOpened) {
					readInitialCommits();
				}
			});
			repos[repoName].addListener('error', function(err) {
				repos[repoName].error = true;
				console.log(repoName + ": " + err.toString());
				numOpened++;
				if(finished && numRepos == numOpened) {
					readInitialCommits();
				}
			});
			callback(null, []);
		} else {
			async.map(files, function(file, callback) {
				if(file == '.git' || file[0] != '.' && exclude.indexOf(file) == -1)
					traverse(basedir, path.join(dir, file), prefix, callback);
				else
					callback(null, []);
			}, function(err, results) {
				if(err) throw err;
				callback(null, Array.prototype.concat.apply([], results));
			});
		}
	});
}

var MAX_COMMITS = 10;

function readInitialCommits() {
	console.log('Reading commits...');
	async.map(Object.keys(repos), function(name, callback) {
		if(repos[name].error) { callback(null, []); return; }
		var repo = repos[name].repo;
		repo.getReference(repos[name].headRef, function(err, ref) {
			if(err) throw err;
			repo.getCommit(ref.target(), function(err, master) {
				if(err) throw err;
				var clist = [];
				var counter = 0;
				GitWatch.walkCommit(repo, master, function(commit, next) {
					if(!commit || counter == MAX_COMMITS) {
						callback(null, clist);
					} else {
						counter++;
						clist.push(formatCommit(name, commit));
						next();
					}
				});
			});
		});
	}, function(err, lists) {
		if(err) throw err;
		var list = Array.prototype.concat.apply([], lists);
		list.sort(function(a, b) {
			var d1 = new Date(a.date);
			var d2 = new Date(b.date);
			return d1>d2?1:d1<d2?-1:0;
		});
		feed = list;
		startWS();
	});
}

var numRepos = 0, numOpened = 0, finished = false;

async.map(Object.keys(config.dirs), function(name, callback) {
	traverse(config.dirs[name], '', name, callback);
}, function() {
	finished = true;
	if(numRepos == numOpened) {
		readInitialCommits();
	}

	Object.keys(repos).forEach(function(name) {
		repos[name].addListener('newCommits', function(newCommits) {
			emitCommits(name, newCommits);
		});
	});
});

function emitCommits(repo, newCommits) {
	for(var i =  newCommits.length-1; i >= 0; i--) {
		var commit = newCommits[i];
		pushCommit(formatCommit(repo, commit));
	}
}

function pushCommit(commit) {
	if(feed.length == MAX_FEED)
		delete feed[0]; // FIXME grossly inefficient!
	feed.push(commit);
	ee.emit('newCommit', commit);
}

function formatCommit(repo, commit) {
	return { repo: repo, sha: commit.sha(),
				author: commit.author().toString(),
				committer: commit.committer().toString(),
				date: commit.date().toString(),
				message: commit.message().trim() };
}

var ee = new EventEmitter();
ee.setMaxListeners(0);

var feed = [];
var MAX_FEED = 50;

function startWS() {
	var wss = new ws.Server({ port: 8097 });
	wss.on('connection', function(ws) {
		feed.forEach(onNewCommit);

		function onNewCommit(newCommit) {
			ws.send(JSON.stringify(newCommit));
		}

		ee.addListener('newCommit', onNewCommit);

		ws.on('close', function() {
			ee.removeListener('newCommit', onNewCommit);
		});
	});
	console.log('OK, started.');
}
