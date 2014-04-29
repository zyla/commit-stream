var GitWatch = require('./lib/git-watch');

var w = new GitWatch('.');

w.on('open', function() {
	console.log('current master: ' + w.refs['refs/heads/master']);
});

w.on('newCommits', function(newCommits) {
	console.log('New commits:');
	newCommits.forEach(function(commit) {
		console.log('* ' + commit.sha() + ' ' + commit.message.trim());
	});
});
