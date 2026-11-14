import AdmZip = require('adm-zip');

/**
 * Find a part inside the archive, tolerating the backslash separators some
 * zip writers use.
 *
 * The OPC format requires forward slashes, but archives written by some
 * Windows tools store `word\styles.xml` instead. Python's zipfile
 * normalises those on read — which is why the Dify plugin opens such files
 * without trouble — but adm-zip matches names literally, so a plain
 * getEntry() misses the part and the style overrides are skipped in
 * silence.
 */
export function findDocxPart(zip: AdmZip, partName: string): AdmZip.IZipEntry | undefined {
    const direct = zip.getEntry(partName);
    if (direct) {
        return direct;
    }

    const wanted = partName.replace(/\\/g, '/');
    return zip.getEntries().find((entry) => entry.entryName.replace(/\\/g, '/') === wanted);
}
