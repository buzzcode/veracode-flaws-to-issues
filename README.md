# Import Veracode Static Analysis Flaws to GitHub Issues - GitHub Action

This action can be used in a workflow after a Veracode Static Analysis (either Pipeline Scan or Policy/Sandbox scan) to take the results of the scan and import them into GitHub as Issues.

## Importing Pipeline Scan flaws
For a Pipeline Scan, this is typically done with the filtered results of the Pipeline Scan, see [Pipeline Scan commands](https://help.veracode.com/r/r_pipeline_scan_commands).  

Note that when Issues are added, a tag is inserted into the Issue title.  The tag is of the form `[VID:<cwe>:<file>:<line>]`.  There is some very simple matching of same file, same CWE, +/- 10 lines that will get resolved as the same issue.

## Importing Policy/Sandbox Scan flaws
For a Policy or Sandbox scan, this is done with the Findings REST API call, see [Findings REST API](https://help.veracode.com/r/c_findings_v2_intro).

Note that when Issues are added, a tag is inserted into the Issue title.  The tag is of the form `[VID:<flaw_number>]`.  This tag is used to prevent duplicate issues from getting created.  

---

## Inputs

### `scan-results-json`

**Required** The path to the scan results file in JSON format.  The scan type, Pipeline or Policy/Sandbox, is auto-detected based on the input file and imported issues are labeled appropriately.
|Default value |  `"filtered_results.json"`|
--- | ---

### `github-token`

**Required** GitHub token needed to access the repo.  Normally, when run in a Workflow, use the `{{ secrets.GITHUB-TOKEN }}` that is created by GitHub.  See [here](https://docs.github.com/en/actions/reference/authentication-in-a-workflow) for further information.

### `wait-time`

**Optional** GitHub (at least the free/public version) has a rate limiter to prevent a user from adding Issues too quickly.  This value is used to insert a small delay between each new issue created so as to not trip the rate limiter.  This value sets the number of seconds between each issue.  See [here](https://docs.github.com/en/rest/guides/best-practices-for-integrators#dealing-with-rate-limits) for additional information.
| Default value | `"2"` |
--- | ---  

## Example usage

### Pipeline Scan

```yaml
  . . . 
# This first step is assumed to exist already in your Workflow
  scan:
    runs-on: ubuntu-latest
    container: 
      image: veracode/pipeline-scan:latest
      options: --user root
    steps:
      - name: get archive
        uses: actions/download-artifact@v2
        with:
          name: scan-target
          path: /tmp

      - name: scan
        run: |
          java -jar /opt/veracode/pipeline-scan.jar \
              -vid ${{ secrets.VERACODE_API_ID }}   \
              -vkey ${{ secrets.VERACODE_API_KEY }} \
              --file /tmp/upload.zip                \
              --fail_on_severity="Very High,High"   \
        continue-on-error: true

      - name: save filtered results file
        uses: actions/upload-artifact@v2
        with:
          name: filtered-results
          path: filtered_results.json

# This step will import the flaws from the step above
  import-issues:
    needs: scan
    runs-on: ubuntu-latest
    steps:
      - name: get scan results
        uses: actions/download-artifact@v2
        with:
          name: filtered-results

      - name: import flaws as issues
        uses: buzzcode/veracode-flaws-to-issues@v1
        with:
          scan-results-json: 'filtered_results.json'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### Policy/Sandbox scan

```yaml
  . . .
# this first step will get existing flaws for an Application Profile (in this case, NodeGoat).  
# 	(obviously) Change the name=<app_name> in the first http call to be 
#	the name of your Application on the Veracode platform
  get-policy-flaws:
    runs-on: ubuntu-latest
    container: 
      image: veracode/api-signing:latest
    steps:
      # Note: this will only work up to about 500 flaws
      #		due to Veracode results limiting
      # See the get_flaws.sh script in the helpers directory
      #		for a more elaborate method
      - name: get policy flaws
        run: |
          cd /tmp
          export VERACODE_API_KEY_ID=${{ secrets.VERACODE_API_ID }}
          export VERACODE_API_KEY_SECRET=${{ secrets.VERACODE_API_KEY }}
          guid=$(http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v1/applications?name=NodeGoat" | jq -r '._embedded.applications[0].guid') 
          echo GUID: ${guid}
          total_flaws=$(http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v2/applications/${guid}/findings?scan_type=STATIC&violates_policy=True" | jq -r '.page.total_elements')
          echo TOTAL_FLAWS: ${total_flaws}
          http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v2/applications/${guid}/findings?scan_type=STATIC&violates_policy=True&size=${total_flaws}" > policy_flaws.json

      - name: save results file
        uses: actions/upload-artifact@v2
        with:
          name: policy-flaws
          path: /tmp/policy_flaws.json

# This step will import flaws from the step above
  import-policy-flaws:
    needs: get-policy-flaws
    runs-on: ubuntu-latest
    steps:
      - name: get flaw file
        uses: actions/download-artifact@v2
        with:
          name: policy-flaws
          path: /tmp

      - name: import flaws as issues
        uses: buzzcode/veracode-flaws-to-issues@v1
        with:
          scan-results-json: '/tmp/policy_flaws.json'
          github-token: ${{ secrets.GITHUB_TOKEN }}
```