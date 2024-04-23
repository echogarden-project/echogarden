# How to help

So far, this project has been the solo work of a single person.

However, there are many areas where contributions can be made.

## Report any issue or bug you encounter

First, check the issue tracker, as well as the [task list](Tasklist.md) to see if the problem is already known to me. The task list allows me to efficiently document and organize a large number of small issues, enhancements or ideas that would otherwise flood an issue tracker with lots of unimportant entries, be ignored, or be forgotten entirely.

If you find the issue you're encountering in the task list, you can still open an issue to discuss it. This allows me to know that someone cares about a particular issue, and I may give it higher priority.

There might be some obvious errors that have gone unreported. Especially if:
* You're using the macOS architecture: I don't have access to a macOS machine, so personally, I did not and cannot perform testing on that platform.
* You're using cloud services: There may be changes in the service that will require updating the code. I don't often test they work correctly, since my trial periods in Google, Microsoft and Amazon have all expired, thus testing requires me to use paid requests.

Since there is a large number of engines, options and behaviors, it is difficult for me to test everything at each release. There are likely edge cases that I didn't think about or noticed.

In any case, please let me know if you get any unexpected error message or surprising behavior that you care about, and I'll try to prioritize it, if possible.

## Report or help fix odd TTS pronunciations and other fail cases

When you encounter an odd pronunciation in a VITS voice, there can be several possible causes:

1. An incorrect phonemization produced by the eSpeak engine. Fortunately, it can be overridden by adding a corrected pronunciation to an Echogarden lexicon. You can pass one or more custom lexicons files to the VITS engine via `vits.customLexiconPaths` and see if it solves the problem. The lexicon format is the same as in [this file](https://github.com/echogarden-project/echogarden/blob/main/data/lexicons/heteronyms.en.json) - you can use it as a reference.
1. This word has multiple different pronunciations based on context (a heteronym). In that case, it may be possible resolve the pronunciations based on context, by using the preceding and succeeding words as indicators. This is supported by the lexicon in the `precededBy`, `notPrecededBy`, `succeededBy`, `notSucceededBy` properties.
1. An issue with model training, which may need to be forwarded to the original authors.

If the problem is serious, you can report it, and we'll see what we can do.

## Fork and make changes to the codebase

See the guide for [setting up a development environment](Development.md).


## Notes about licensing

The code is currently licensed under GPL-v3, mainly due to one of its core dependencies, [eSpeak-NG](https://github.com/espeak-ng/espeak-ng), having this license.

In the future, I may want to re-license parts (or all) of the code to a more permissive license like MIT, if that turns out to be possible. If you make an external contribution, I would appreciate if you also agree to license it under the MIT license, so a future transition would be easier.
