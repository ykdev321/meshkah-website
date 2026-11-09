# Hadith collections used by Mishkat

Arabic source editions are fetched from the public `fawazahmed0/hadith-api` repository, pinned to branch/version `1`.

- `nawawi`: `ara-nawawi` (42 narrations in the API edition)
- `bukhari`: `ara-bukhari`
- `muslim`: `ara-muslim`
- `abudawud`: `ara-abudawud`
- `tirmidhi`: `ara-tirmidhi`
- `nasai`: `ara-nasai`
- `ibnmajah`: `ara-ibnmajah`

The project intentionally does not attach a blanket authenticity grade to any collection. In particular, the Sunan collections include narrations with different gradings; an individual grade must be backed by a separate, reliable reference.

Download locally:

```bash
bash tools/download-hadith-collections.sh nawawi
bash tools/download-hadith-collections.sh bukhari muslim
bash tools/download-hadith-collections.sh --all
```

The files are minified JSON, loaded one collection at a time, and are kept in Cache Storage where supported. On this build host the external DNS lookup failed, so the JSON corpus itself could not be pre-bundled here; the website has a remote fallback and the downloader is included so the complete texts can be added before deployment.
