#! /bin/sh

guid=$(http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v1/applications?name=NodeGoat" | jq -r '._embedded.applications[0].guid') 
echo GUID: ${guid}

total_pages=$(http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v2/applications/${guid}/findings?scan_type=STATIC&violates_policy=True" | jq -r '.page.total_pages')
echo Pages: ${total_pages}

output_file=flaws_all.json

if [ ${total_pages} == 1 ]
then
	
	# TODO: test
	
	http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v2/applications/${guid}/findings?scan_type=STATIC&violates_policy=True" > ${output_file}
else
	# get the first page
	echo Getting flaws, page 0
	http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v2/applications/${guid}/findings?scan_type=STATIC&violates_policy=True&page=0" > flaws_p0.json

	# get the rest of the pages and merge flaws
	for (( page=1; page<${total_pages}; page++ ))
	do
		echo Getting flaws, page ${page}
		http --auth-type veracode_hmac GET "https://api.veracode.com/appsec/v2/applications/${guid}/findings?scan_type=STATIC&violates_policy=True&page=${page}" > flaws_tmp.json
		
		echo Merging flaws, page `expr ${page} - 1` into page ${page}
		jq -s '.[0] as $f1 | .[1] as $f2 | ($f1 + $f2) | ._embedded.findings = ($f1._embedded.findings + $f2._embedded.findings)' flaws_p`expr ${page} - 1`.json flaws_tmp.json > flaws_p${page}.json
	done
	
	mv flaws_p`expr ${page} - 1`.json ${output_file}
fi
