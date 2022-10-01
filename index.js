//
// entry point when called from a Workflow Action
//

const core = require('@actions/core');
const github = require('@actions/github');
//const process = require('@process');

const importFlaws = require('./importer').importFlaws;

try {
    // get input params
    const resultsFile = core.getInput('scan-results-json', {required: true} );
    const token = core.getInput('github-token', {required: true} );
    const waitTime = core.getInput('wait-time');                // default set in Action.yml
    const source_base_path_1 = core.getInput('source-base-path_1'); 
    const source_base_path_2 = core.getInput('source-base-path_2'); 
    const source_base_path_3 = core.getInput('source-base-path_3');
    const commit_hash = core.getInput('commit-hash');

    // other params
    const owner = github.context.repo.owner;
    const repo = github.context.repo.repo;
    // context {{ github.repository }}  = 'owner/reponame'

    //console.log(`Calling with: resultsFile: ${resultsFile}, token: ${token}, waitTime: ${waitTime}, owner: ${owner}, repo: ${repo}`)

    core.info('check if we run on a pull request')
    let pullRequest = process.env.GITHUB_REF
    console.log('pull request: '+pullRequest)
    let isPR = pullRequest.indexOf("pull")

    console.log('Is PR: '+isPR)

    if ( isPR >= 1 ){
        core.info("This run is part of a PR, should add some PR comment")

        const pr_context = github.context
        const pr_repository = process.env.GITHUB_REPOSITORY
        const pr_repo = pr_repository.split("/");
        const pr_commentID = context.payload.pull_request.number
        console.log('PR Context: '+pr_context+'\nPr Repository: '+pr_repository+'\nPr Repo: '+pr_repo+'\nPR Comment ID: '+pr_commentID)
    }

    // do the thing
    importFlaws(
        {resultsFile: resultsFile,
         githubOwner: owner,
         githubRepo: repo,
         githubToken: token,
         waitTime: waitTime,
         source_base_path_1: source_base_path_1,
         source_base_path_2: source_base_path_2,
         source_base_path_3: source_base_path_3,
         commit_hash: commit_hash,
         pr_context: pr_context,
         pr_repository: pr_repository,
         pr_repo: pr_repo,
         pr_commentID: pr_commentID
        }
    )
    .catch(error => {console.error(`Failure at ${error.stack}`)});
} catch (error) {
    core.setFailed(error.stack);
}
