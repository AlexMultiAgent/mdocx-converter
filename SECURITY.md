# Security Policy

## Reporting a vulnerability

Report security problems privately through GitHub's private vulnerability reporting:

**https://github.com/AlexMultiAgent/mdocx-converter/security/advisories/new**

Please do not open a public issue for a vulnerability. A public report makes the problem known before a fix exists, which leaves every user of the two products exposed.

## What counts as a vulnerability

This repository ships two products that convert Markdown into Word documents:

- the **VS Code extension** in `VSC-plugin-MD2Docx-Converter/`
- the **Dify plugin** in `dify-plugin-MD2Docx/`

A report counts as a vulnerability when crafted input can make one of the products do something the user did not ask for, or expose data the user did not intend to share. Typical examples:

- Markdown input that makes a plugin read or write files outside the working directory, or run a command that was never requested
- a way around the Pandoc sandbox or the Mermaid Ink URL filter to pull content from an arbitrary host
- a template, profile or packaging path that allows traversal or injection
- a crash that a crafted document triggers reliably

Not vulnerabilities: rendering differences in the produced document, missing features, and problems in the third-party services the plugins call (Pandoc, Mermaid Ink, VS Code, Dify).

## What to expect

We aim to acknowledge a report within **7 days** and to publish a fix or a security advisory within **90 days**. We will keep you updated while the vulnerability is being investigated, and we will credit you in the advisory unless you prefer to stay anonymous.

Please include the affected product, its version, the input that reproduces the problem and what you observed. A minimal reproduction is worth more than a long description.

## Coordinated disclosure

We follow a coordinated disclosure practice: the reporter receives the fix and the advisory text before any details become public. We ask for a reasonable embargo until that advisory is ready, and we do not publish a vulnerability before the disclosure timeline above has been met. Every disclosure ends with a public advisory on the repository's Security Advisories page. If several vulnerabilities are reported at once, we may publish one advisory that covers all of them.

Advisories for already fixed vulnerabilities are published on the same page.

## Supported versions

Both products share a single version line. The current release is **0.5.2**.

| Version | Supported |
| --- | --- |
| 0.5.2 | Yes |
| < 0.5.2 | No |

Security fixes land on the current version line only, so please upgrade to 0.5.2 before testing a report.
