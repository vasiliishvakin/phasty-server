import pc from 'picocolors'

/**
 * @param {string} message
 */
export function serviceLog(message) {
    console.log(pc.cyan('  ' + message))
}

/**
 * @param {string} label
 * @param {string} url
 */
export function serviceUrl(label, url) {
    console.log(pc.cyan('  ' + label + ' ') + pc.bold(pc.green(url)))
}
