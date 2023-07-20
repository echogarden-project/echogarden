# How to help

So far, this project has been the solo work of a single person.

However, there are many areas where contributions can be made.

## Report any issue or bug you encounter

First, check out the [task list](Tasklist.md) to see if the problem is already known to me. The task list allows me to efficiently document and organize a large quantity of small issues, enhancements or ideas that would otherwise flood an issue tracker with lots of unimportant entries, be ignored, or forgotten entirely.

If you find the issue you're encountering in the task list, you can still open an issue to discuss it. This allows me to know that someone cares about a particular issue, and I may give it higher priority.

There might be some obvious errors that have gone unreported. Especially if you're using the macOS platform, since I don't have access to a macOS machine, and thus almost no real testing has been done over that platform.

In any case, please let me know if you get any unexpected error message or surprising behavior that you care about, and I'll try to prioritize it, if possible.

## Report odd TTS pronunciations and other fail cases

When you encounter an odd pronunciation, there are several possible causes:

1. An incorrect phonemization produced by the eSpeak engine. Fortunately, it can be overridden by adding a corrected pronunciations in the Echogarden lexicon.
1. This word has multiple different pronunciations based on context (a heteronym). In that case, it may be possible resolve the pronunciations based on context, by using the preceding and succeeding words as indicators. This is supported by the Echogarden lexicon.
1. An issue with model training, which may need to be forwarded to the original authors.

If the problem is serious, you can report it and we'll see what we can do.
