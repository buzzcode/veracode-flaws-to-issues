//
// GitHub issue importer
//

const { request } = require('@octokit/request');

// add the flaw to GitHub as an Issue
async function addVeracodeIssue(options, issue) {

    const label = require('./label');
    const ApiError = require('./util').ApiError;

    const githubOwner = options.githubOwner;
    const githubRepo = options.githubRepo;
    const githubToken = options.githubToken;

    console.debug(`Adding Issue for ${issue.title}`);

    var authToken = 'token ' + githubToken;

    if ( options.pr_commentID ){
        pr_link = "\"pull_request\"\: \[\"url: https://api.github.com/repos/octocat/Hello-World/pulls/1347\", \"html_url: https://github.com/octocat/Hello-World/pull/1347\", \"diff_url; https://github.com/octocat/Hello-World/pull/1347.diff\",\"patch_url: https://github.com/octocat/Hello-World/pull/1347.patch\"\],"
    }


    await request('POST /repos/{owner}/{repo}/issues', {
        headers: {
            authorization: authToken
        },
        owner: githubOwner,
        repo: githubRepo,
        data: {
            "title": issue.title,
            "labels": [label.severityToLabel(issue.severity), issue.label],
            pr_link
            "body": issue.body
        }
    })
    .then( result => {
        console.log(`Issue successfully created, result: ${result.status}`);
    })
    .catch( error => {
        // 403 possible rate-limit error
        if((error.status == 403) && (error.message.indexOf('abuse detection') > 0) ) {

            console.warn(`GitHub rate limiter tripped, ${error.message}`);

            throw new ApiError('Rate Limiter tripped');
        } else {
            throw new Error (`Error ${error.status} creating Issue for \"${issue.title}\": ${error.message}`);
        }           
    });
}

module.exports = { addVeracodeIssue };