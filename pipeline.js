//
// handle pipeline scan flaws
//

const { request } = require('@octokit/request');
const label = require('./label');
const addVeracodeIssue = require('./issue').addVeracodeIssue;

/* Map of files that contain flaws
 *  each entry is a struct of {CWE, line_number}  
 *  for some admittedly loose, fuzzy matching to prevent duplicate issues */
var flawFiles = new Map();

function createVeracodeFlawID(flaw) {
    // [VID:CWE:filename:linenum]
    return('[VID:' + flaw.cwe_id +':' + flaw.files.source_file.file + ':' + flaw.files.source_file.line + ']')
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
        "cwe": parts[1],
        "file": parts[2],
        "line": parts[3].substring(0, parts[3].length - 1)
      })
}

function addExistingFlawToMap(vid) {
    let flawInfo = parseVeracodeFlawID(vid);
    let flaw = {'cwe': flawInfo.cwe,
                'line': flawInfo.line};
    
    if(flawFiles.has(flawInfo.file)) {
        // already have some flaws in this file, so just add this specific flaw to the array
        let flaws = flawFiles.get(flawInfo.file);
        flaws.push(flaw);
    } else {
        // add this file into the map, with the fist of (possible) multiple flaws
        flawFiles.set(flawInfo.file, [flaw])
    }
}

function issueExists(vid) {
    // same file and CWE, +/- 10 lines of code
    let flawInfo = parseVeracodeFlawID(vid)

    if(flawFiles.has(flawInfo.file)) {
        // check all the flaws in this file to see if we have a match
        for(i = 0; i < flawFiles.get(flawInfo.file).length; i++) {
            let existingFlaw = flawFiles.get(flawInfo.file)[i];
            
            // check CWE
            if(flawInfo.cwe == existingFlaw.cwe) {
                // check (+/- 10 lines)
                let newFlawLine = parseInt(flawInfo.line);

                let existingFlawLine = parseInt(existingFlaw.line);
                if( (newFlawLine >= (existingFlawLine - 10)) && (newFlawLine <= (existingFlawLine + 10)) ) {
                    return true;
                }
            }
        }
    }

    return false;
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
        let uriType = encodeURIComponent(label.otherLabels.find( val => val.id === 'pipeline').name);
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
                        addExistingFlawToMap(flawID);
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

async function processPipelineFlaws(options, flawData) {

    const util = require('./util');

    const waitTime = parseInt(options.waitTime);

    // get a list of all open VeracodeSecurity issues in the repo
    await getAllVeracodeIssues(options)

    // walk through the list of flaws in the input file
    console.log(`Processing input file: \"${options.resultsFile}\" with ${flawData.findings.length} flaws to process.`)
    var index;
    for( index=0; index < flawData.findings.length; index++) {
        let flaw = flawData.findings[index];

        let vid = createVeracodeFlawID(flaw);
        console.debug(`processing flaw ${flaw.issue_id}, VeracodeID: ${vid}`);

        // check for duplicate
        if(issueExists(vid)) {
            console.log('Issue already exists, skipping import');
            continue;
        }


        //rewrite path
        function replacePath (rewrite, path){
            replaceValues = rewrite.split(":")
            //console.log('Value 1:'+replaceValues[0]+' Value 2: '+replaceValues[1]+' old path: '+path)
            newPath = path.replace(replaceValues[0],replaceValues[1])
            //console.log('new Path:'+newPath)
            return newPath
        }

        filename = flaw.files.source_file.file

        if (options.source_base_path_1 || options.source_base_path_2 || options.source_base_path_3){
            orgPath1 = options.source_base_path_1.split(":")
            orgPath2 = options.source_base_path_2.split(":")
            orgPath3 = options.source_base_path_3.split(":")
            //console.log('path1: '+orgPath1[0]+' path2: '+orgPath2[0]+' path3: '+orgPath3[0])

            if( filename.includes(orgPath1[0])) {
                //console.log('file path1: '+filename)
                filepath = replacePath(options.source_base_path_1, filename)
            }
            else if (filename.includes(orgPath2[0])){
                //console.log('file path2: '+filename)
                filepath = replacePath(options.source_base_path_2, filename)
            }
            else if (filename.includes(orgPath3[0])){
                //console.log('file path3: '+filename)
                filepath = replacePath(options.source_base_path_3, filename)
            }
            //console.log('Filepath:'+filepath);
        }

        linestart = eval(flaw.files.source_file.line-5)
        linened = eval(flaw.files.source_file.line+5)

        commit_path = "https://github.com/"+options.githubOwner+"/"+options.githubRepo+"/blob/"+options.commit_hash+"/"+filepath+"#L"+linestart+"-L"+linened

        //console.log('Full Path:'+commit_path)






        // add to repo's Issues
        // (in theory, we could do this w/o await-ing, but GitHub has rate throttling, so single-threading this helps)
        let title = `${flaw.issue_type} ` + createVeracodeFlawID(flaw);
        let lableBase = label.otherLabels.find( val => val.id === 'pipeline').name;
        let severity = flaw.severity;
        let bodyText = `${commit_path}`;
        bodyText += `\n\n**Filename:** ${flaw.files.source_file.file}`;
        bodyText += `\n\n**Line:** ${flaw.files.source_file.line}`;
        bodyText += `\n\n**CWE:** ${flaw.cwe_id} (${flaw.issue_type})`;
        bodyText += '\n\n' + decodeURI(flaw.display_text);

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

module.exports = { processPipelineFlaws }