Nawawi collection data
----------------------
To bundle the complete Arabic collection with the project before deployment, run:
  bash tools/download-nawawi40.sh
The script downloads one JSON file from the ara-nawawi edition of fawazahmed0/hadith-api (The Unlicense), then verifies all 42 numbered hadith texts before saving it here as nawawi40.json.
If that file is not bundled, Mishkat attempts to fetch it the first time the Hadith panel is opened and stores the successful response in this browser's Cache Storage for subsequent offline use.
