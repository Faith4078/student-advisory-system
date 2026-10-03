/**
 * Google Apps Script that programmatically builds the "Thesisly Feedback
 * Survey — Project Repository & AI Advisor" Google Form.
 *
 * HOW TO RUN:
 *   1. Go to https://script.google.com -> New project (or, from any Google
 *      Sheet/Doc, Extensions > Apps Script).
 *   2. Delete the default empty function and paste this entire file in.
 *   3. Select "createThesislyFeedbackForm" in the function dropdown at the
 *      top, then click Run. The first run will ask you to authorize the
 *      script (it needs permission to create Forms in your Drive).
 *   4. Open the Execution log (View > Logs, or Ctrl+Enter) to get the
 *      form's published URL and edit URL.
 *
 * Running it again creates a brand-new form each time (it does not edit an
 * existing one), so only run it once per form you actually want.
 */
function createThesislyFeedbackForm() {
  var form = FormApp.create('Thesisly Feedback Survey — Project Repository & AI Advisor');
  form.setDescription(
    'This survey takes about 4 minutes. Your responses are anonymous and ' +
    'will be used to evaluate the Thesisly project repository and AI ' +
    'Advisor for a final-year research project.'
  );
  form.setCollectEmail(false);
  form.setAllowResponseEdits(false);
  form.setConfirmationMessage('Thank you for your feedback! It has been recorded.');

  // ---------------------------------------------------------------
  // Section 1: About You (first page, no page break needed before it)
  // ---------------------------------------------------------------
  form.addSectionHeaderItem()
    .setTitle('Section 1: About You')
    .setHelpText('Just enough context to group responses — nothing identifying is collected.');

  form.addMultipleChoiceItem()
    .setTitle('What level are you currently in?')
    .setChoiceValues(['100', '200', '300', '400', '500'])
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Have you used Thesisly before today?')
    .setChoiceValues(['Yes', 'No'])
    .setRequired(true);

  // ---------------------------------------------------------------
  // Section 2: Repository & Search
  // ---------------------------------------------------------------
  form.addPageBreakItem().setTitle('Section 2: Repository & Search');

  form.addMultipleChoiceItem()
    .setTitle('Were you able to find project information relevant to your interests using the search feature?')
    .setChoiceValues(['Yes, fully', 'Partially', 'No'])
    .setRequired(true);

  form.addScaleItem()
    .setTitle('How relevant were the search results to what you were looking for?')
    .setBounds(1, 5)
    .setLabels('Not relevant at all', 'Extremely relevant')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle('Did you try uploading or viewing a project report?')
    .setChoiceValues(['Yes, it worked', 'Yes, but I had issues', "No, I didn't try"])
    .setRequired(true);

  // ---------------------------------------------------------------
  // Section 3: AI Academic Advisor (ends with the branching question)
  // ---------------------------------------------------------------
  form.addPageBreakItem().setTitle('Section 3: AI Academic Advisor');

  form.addScaleItem()
    .setTitle('How helpful was the AI Advisor in helping you explore or refine a project idea?')
    .setBounds(1, 5)
    .setLabels('Not helpful', 'Extremely helpful')
    .setRequired(true);

  form.addMultipleChoiceItem()
    .setTitle("Did the AI Advisor's answers reference specific, real past projects (not just vague or generic suggestions)?")
    .setChoiceValues(['Always', 'Mostly', 'Sometimes', 'Rarely', 'Never'])
    .setRequired(true);

  // Created now, without navigation, so it can still be placed here in
  // physical page order; its branching choices are wired up at the very
  // end of this function, once the destination pages below also exist.
  var groundednessItem = form.addMultipleChoiceItem()
    .setTitle('Did the Advisor ever say anything that seemed made up, inaccurate, or not actually backed by a real project?')
    .setChoiceValues(['Yes', 'No', 'Not sure'])
    .setRequired(true);

  // ---------------------------------------------------------------
  // Follow-up page: only shown if the answer above was "Yes"
  // ---------------------------------------------------------------
  var followUpPage = form.addPageBreakItem().setTitle('Follow-up');

  form.addParagraphTextItem()
    .setTitle('Please briefly describe what it said.')
    .setRequired(true);

  // ---------------------------------------------------------------
  // Section 4: System Usability Scale (SUS) — official wording, do not
  // paraphrase; the standard 0-100 scoring and benchmark bands depend on
  // using these exact 10 statements.
  // ---------------------------------------------------------------
  var susPage = form.addPageBreakItem().setTitle('Section 4: System Usability Scale');

  form.addGridItem()
    .setTitle('Please rate your agreement with each statement below.')
    .setRows([
      'I think that I would like to use this system frequently.',
      'I found the system unnecessarily complex.',
      'I thought the system was easy to use.',
      'I think that I would need the support of a technical person to be able to use this system.',
      'I found the various functions in this system were well integrated.',
      'I thought there was too much inconsistency in this system.',
      'I would imagine that most people would learn to use this system very quickly.',
      'I found the system very cumbersome to use.',
      'I felt very confident using the system.',
      'I needed to learn a lot of things before I could get going with this system.'
    ])
    .setColumns(['Strongly Disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly Agree'])
    .setRequired(true);

  // ---------------------------------------------------------------
  // Section 5: Open Feedback
  // ---------------------------------------------------------------
  form.addPageBreakItem().setTitle('Section 5: Open Feedback');

  form.addParagraphTextItem()
    .setTitle('What did you like most about Thesisly?')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('What would you improve or add?')
    .setRequired(false);

  form.addParagraphTextItem()
    .setTitle('Any other comments?')
    .setRequired(false);

  // ---------------------------------------------------------------
  // Wire up the Section 3 branching now that both destination pages
  // (followUpPage and susPage) exist as variables. This only changes the
  // item's navigation behaviour, not its physical position in the form.
  // ---------------------------------------------------------------
  groundednessItem.setChoices([
    groundednessItem.createChoice('Yes', followUpPage),
    groundednessItem.createChoice('No', susPage),
    groundednessItem.createChoice('Not sure', susPage)
  ]);

  Logger.log('Form created successfully.');
  Logger.log('Published URL (send this to respondents): ' + form.getPublishedUrl());
  Logger.log('Edit URL (for you, to view/edit the form and its responses): ' + form.getEditUrl());
}
