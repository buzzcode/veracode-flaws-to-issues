//
// handle policy & sandbox scan flaws
//

const { request } = require('@octokit/request');
const label = require('./label');
const addVeracodeIssue = require('./issue').addVeracodeIssue;

// sparse array, element = true if the flaw exists, undefined otherwise
var existingFlaws = [];



function createVeracodeFlawID(flaw) {
    // [VID:FlawID]
    return('[VID:' + flaw.issue_id + ']')
}

// given an Issue title, extract the FlawID string (for existing issues)
function getVeracodeFlawID(title) {
    let start = title.indexOf('[VID');
    if(start == -1) {
        return null;
    }
    let end = title.indexOf(']', start);

    return title.substring(start, end+1);
}

function parseVeracodeFlawID(vid) {
    let parts = vid.split(':');

    return ({
        "prefix": parts[0],
        "flawNum": parts[1].substring(0, parts[1].length - 1)
      })
}

// get existing Veracode-entered issues, to avoid dups
async function getAllVeracodeIssues(options) {
    const githubOwner = options.githubOwner;
    const githubRepo = options.githubRepo;
    const githubToken = options.githubToken;

    var authToken = 'token ' + githubToken;

    // when searching for issues, the label list is AND-ed (all requested labels must exist for the issue),
    // so we need to loop through each severity level manually
    for(const element of label.flawLabels) {

        // get list of all flaws with the VeracodeFlaw label
        console.log(`Getting list of existing \"${element.name}\" issues`);

        let done = false;
        let pageNum = 1;

        let uriSeverity = encodeURIComponent(element.name);
        let uriType = encodeURIComponent(label.otherLabels.find( val => val.id === 'policy').name);
        let reqStr = `GET /repos/{owner}/{repo}/issues?labels=${uriSeverity},${uriType}&state=open&page={page}`
        //let reqStr = `GET /repos/{owner}/{repo}/issues?labels=${uriName},${uriType}&state=open&page={page}&per_page={pageMax}`

        while(!done) {
            await request(reqStr, {
                headers: {
                    authorization: authToken
                },
                owner: githubOwner,
                repo: githubRepo,
                page: pageNum,
                //pageMax: 3
            })
            .then( result => {
                console.log(`${result.data.length} flaw(s) found, (result code: ${result.status})`);

                // walk findings and populate VeracodeFlaws map
                result.data.forEach(element => {
                    let flawID = getVeracodeFlawID(element.title);

                    // Map using VeracodeFlawID as index, for easy searching.  Line # for simple flaw matching
                    if(flawID === null){
                        console.log(`Flaw \"${element.title}\" has no Veracode Flaw ID, ignored.`)
                    } else {
                        flawNum = parseVeracodeFlawID(flawID).flawNum;
                        existingFlaws[parseInt(flawNum)] = true;
                    }
                })

                // check if we need to loop
                // (if there is a link field in the headers, we have more than will fit into 1 query, so 
                //  need to loop.  On the last query we'll still have the link, but the data will be empty)
                if( (result.headers.link !== undefined) && (result.data.length > 0)) {
                        pageNum += 1;
                }
                else 
                    done = true;
            })
            .catch( error => {
                throw new Error (`Error ${error.status} getting VeracodeFlaw issues: ${error.message}`);
            });
        }
    }
}

function issueExists(vid) {
    if(existingFlaws[parseInt(parseVeracodeFlawID(vid).flawNum)] === true)
        return true;
    else
        return false;
}

async function processPolicyFlaws(options, flawData) {

    const util = require('./util');

    const waitTime = parseInt(options.waitTime);

    // get a list of all open VeracodeSecurity issues in the repo
    await getAllVeracodeIssues(options)

    // walk through the list of flaws in the input file
    console.log(`Processing input file: \"${options.resultsFile}\" with ${flawData._embedded.findings.length} flaws to process.`)
    var index;
    for( index=0; index < flawData._embedded.findings.length; index++) {
        let flaw = flawData._embedded.findings[index];

        let vid = createVeracodeFlawID(flaw);
        console.debug(`processing flaw ${flaw.issue_id}, VeracodeID: ${vid}`);

        // check for duplicate
        if(issueExists(vid)) {
            console.log('Issue already exists, skipping import');
            continue;
        }

        // add to repo's Issues
        // (in theory, we could do this w/o await-ing, but GitHub has rate throttling, so single-threading this helps)
        let title = `${flaw.finding_details.cwe.name} ('${flaw.finding_details.finding_category.name}') ` + createVeracodeFlawID(flaw);
        let lableBase = label.otherLabels.find( val => val.id === 'policy').name;
        let severity = flaw.finding_details.severity;
        let bodyText = `**Filename:** ${flaw.finding_details.file_name}`;
        bodyText += `\n\n**Line:** ${flaw.finding_details.file_line_number}`;
        bodyText += `\n\n**CWE:** ${flaw.finding_details.cwe.id} (${flaw.finding_details.cwe.name} ('${flaw.finding_details.finding_category.name}'))`;
        bodyText += '\n\n' + decodeURI(flaw.description);

        let issue = {
            'title': title,
            'label': lableBase,
            'severity': severity,
            'body': bodyText
        };
        
        await addVeracodeIssue(options, issue)
        .catch( error => {
            if(error instanceof util.ApiError) {

                // TODO: fall back, retry this same issue, continue process

                // for now, only 1 case - rate limit tripped
                //console.warn('Rate limiter tripped.  30 second delay and time between issues increased by 2 seconds.');
                // await sleep(30000);
                // waitTime += 2;

                // // retry this same issue again, bail out if this fails
                // await addVeracodeIssue(options, flaw)
                // .catch( error => {
                //     throw new Error(`Issue retry failed ${error.message}`);
                // })

                throw error;
            } else {
                //console.error(error.message);
                throw error; 
            }
        })

        // progress counter for large flaw counts
        if( (index > 0) && (index % 25 == 0) )
            console.log(`Processed ${index} flaws`)

        // rate limiter, per GitHub: https://docs.github.com/en/rest/guides/best-practices-for-integrators
        if(waitTime > 0)
            await util.sleep(waitTime * 1000);
    }

    return index;
}

module.exports = { processPolicyFlaws }