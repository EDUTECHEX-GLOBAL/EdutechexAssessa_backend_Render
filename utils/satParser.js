const pdf = require('pdf-parse');
const {
  BedrockRuntimeClient,
  InvokeModelCommand
} = require('@aws-sdk/client-bedrock-runtime');
const SATMathGenerator = require('./satMathGenerator');

// Initialize AWS Bedrock client
const bedrockClient = new BedrockRuntimeClient({
  region: process.env.AWS_MODEL_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_MODEL_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_MODEL_ACCESS_KEY,
  },
});

// ==================== HELPER FUNCTIONS ====================

function withTimeout(promise, ms, timeoutMessage = 'Operation timed out') {
  const timeout = new Promise((_, reject) => 
    setTimeout(() => reject(new Error(timeoutMessage)), ms)
  );
  return Promise.race([promise, timeout]);
}

// ==================== FIXED: NO "NO CHANGE" EXAMPLES ====================
function getExampleForDifficulty(sectionType, difficulty) {
  if (sectionType === 'reading') {
    switch(difficulty) {
      case 'easy':
        return `Passage: The Industrial Revolution began in Britain in the late 18th century. It marked a shift from manual production to machine manufacturing. This transformation led to urbanization as people moved to cities for factory work.

1. The passage primarily discusses:
A. The causes of the Industrial Revolution
B. The transformation from manual to machine production
C. Urban planning in 18th century Britain
D. Agricultural practices before industrialization
Correct: B`;
      
      case 'medium':
        return `Passage: In Mary Shelley's "Frankenstein," the creature's isolation stems not from his appearance alone, but from society's refusal to recognize his humanity. Shelley critiques the Enlightenment emphasis on rationality by showing how the creature's emotional needs are ignored.

1. The passage suggests that "Frankenstein" criticizes Enlightenment values by:
A. Demonstrating the limitations of pure rationality
B. Advocating for scientific progress at all costs
C. Celebrating emotional detachment as virtue
D. Rejecting Romantic era sensibilities
Correct: A`;
      
      case 'hard':
        return `Passage: The debate over climate change policy often centers on economic costs versus environmental benefits. However, this framing ignores the concept of "stranded assets"—fossil fuel resources that must remain unused to meet climate targets.

1. The author introduces the concept of "stranded assets" primarily to:
A. Highlight an overlooked economic dimension of climate policy
B. Critique environmentalists for ignoring economic realities
C. Advocate for immediate fossil fuel divestment
D. Question the validity of climate change predictions
Correct: A`;
      
      case 'very hard':
        return `Passage 1: Traditional economic models assume rational actors maximizing utility. Behavioral economics challenges this, showing systematic cognitive biases in decision-making.

Passage 2: Neuroeconomics integrates neuroscience with economic analysis. Brain imaging reveals that emotional centers activate during financial decisions.

1. Both passages primarily discuss:
A. The biological basis of economic decision-making
B. Critiques of traditional economic assumptions
C. Applications of neuroscience to policy
D. Historical development of economic theory
Correct: B`;
    }
  } else { // writing - COMPLETELY REWRITTEN WITHOUT "NO CHANGE"
    switch(difficulty) {
      case 'easy':
        return `Passage: The team working on the project have completed all their tasks ahead of schedule.

1. Which choice corrects the subject-verb agreement error?
A. project, they have completed
B. project; they have completed
C. project has completed
D. project and have completed
Correct: C`;
      
      case 'medium':
        return `Passage: Many cities have implemented bike-sharing programs. These programs reduce traffic congestion. They also promote physical activity. However, some critics argue the programs are underutilized.

1. Which choice most effectively combines the underlined sentences?
A. programs, but these reduce
B. programs that reduce
C. programs; they reduce
D. programs, reducing
Correct: D`;
      
      case 'hard':
        return `Passage: The author's analysis of demographic trends, while statistically rigorous, fails to account for qualitative dimensions of social experience. Quantitative data cannot capture the subjective meanings individuals attach to their social positions.

1. Which choice best improves the precision of the underlined phrase?
A. rigorous in its statistical approach
B. statistically sophisticated yet
C. methodologically sound although
D. empirically robust while
Correct: B`;
      
      case 'very hard':
        return `Passage: Recent scholarship on the Renaissance has challenged the traditional narrative of sudden cultural rebirth following medieval stagnation. This revisionist historiography emphasizes continuities with medieval thought while acknowledging the period's genuine innovations.

1. The writer wants to add a sentence that elaborates on the period's "complex transformation." Which choice most effectively accomplishes this goal?
A. Medieval scholasticism remained influential throughout the fifteenth century.
B. Humanist thinkers selectively adapted classical models to contemporary needs.
C. Artistic techniques evolved gradually rather than appearing fully formed.
D. The period witnessed both recovery of ancient texts and development of new intellectual frameworks.
Correct: D`;
    }
  }
}

// Parse generated reading/writing text
function parseGeneratedReadingWriting(generatedText, sectionType, difficulty, expectedCount) {
  const questions = [];
  const lines = generatedText.split('\n').map(l => l.trim()).filter(Boolean);
  
  let currentPassage = '';
  let parsingPassage = false;
  let passageCount = 0;
  
  for (let i = 0; i < lines.length && passageCount < expectedCount; i++) {
    const line = lines[i];
    
    if (line.toLowerCase().startsWith('passage')) {
      parsingPassage = true;
      currentPassage = line.replace(/^passage\s*[:\-\d]*\s*/i, '').trim();
      
      for (let j = i + 1; j < lines.length; j++) {
        if (/^\d+\.\s/.test(lines[j])) {
          i = j - 1;
          break;
        }
        if (lines[j].toLowerCase().startsWith('passage')) {
          i = j - 1;
          break;
        }
        currentPassage += ' ' + lines[j];
      }
      currentPassage = currentPassage.trim();
      continue;
    }
    
    const qMatch = line.match(/^(\d+)\.\s*(.+)/);
    if (qMatch && currentPassage) {
      const questionText = qMatch[2].trim();
      const options = [];
      let correctAnswer = null;
      
      for (let j = i + 1; j < Math.min(i + 10, lines.length); j++) {
        const optMatch = lines[j].match(/^([A-D])[\.\)]\s*(.+)/i);
        if (optMatch) {
          options.push(optMatch[2].trim());
          continue;
        }
        
        const ansMatch = lines[j].match(/Correct[:\-]?\s*([A-D])/i);
        if (ansMatch) {
          correctAnswer = ['A','B','C','D'].indexOf(ansMatch[1].toUpperCase());
          break;
        }
        
        if (/^\d+\.\s/.test(lines[j]) || lines[j].toLowerCase().startsWith('passage')) {
          break;
        }
      }
      
      if (options.length === 4 && correctAnswer !== null) {
        questions.push({
          type: 'mcq',
          questionText,
          passage: currentPassage,
          options,
          correctAnswer,
          marks: 1,
          fromAI: true,
          sectionType: sectionType,
          difficulty: difficulty,
          verified: true
        });
        
        passageCount++;
        currentPassage = '';
        parsingPassage = false;
      }
    }
  }
  
  return questions;
}

// ==================== FIXED: FALLBACK WRITING WITHOUT "NO CHANGE" ====================
function generateSATFallbackReadingWriting(sectionType, difficulty, count) {
  const questions = [];
  
  const readingTopics = {
    'easy': [
      "The benefits of regular exercise on mental health",
      "Basic principles of photosynthesis in plants",
      "The importance of recycling for environmental protection",
      "How bees contribute to pollination and agriculture"
    ],
    'medium': [
      "The historical significance of the printing press",
      "Psychological theories of motivation and behavior",
      "Economic factors contributing to urbanization",
      "Literary analysis of symbolism in classic novels"
    ],
    'hard': [
      "Ethical implications of artificial intelligence development",
      "Neurological basis of memory formation and recall",
      "Postcolonial critiques of Western historiography",
      "Quantum computing's potential impact on cryptography"
    ],
    'very hard': [
      "Epistemological debates in philosophy of science",
      "Sociological analysis of digital culture and identity",
      "Comparative analysis of economic systems post-globalization",
      "Interdisciplinary approaches to climate change mitigation"
    ]
  };
  
  const writingIssues = {
    'easy': ["subject-verb agreement", "pronoun reference", "basic punctuation"],
    'medium': ["logical transitions", "word choice precision", "sentence structure"],
    'hard': ["rhetorical effectiveness", "tone consistency", "evidence integration"],
    'very hard': ["argumentative coherence", "sophisticated syntax", "theoretical framing"]
  };
  
  function getReadingQuestionForDifficulty(difficulty, topic) {
    const questions = {
      'easy': [
        `What is the main topic of the passage?`,
        `The passage primarily discusses:`,
        `What is the author's main point about ${topic.split(' ')[0]}?`
      ],
      'medium': [
        `Based on the passage, which statement would the author most likely agree with?`,
        `The author mentions ${topic.split(' ')[0]} primarily to:`,
        `Which choice best describes the author's perspective on ${topic.split(' ')[0]}?`
      ],
      'hard': [
        `The passage suggests that ${topic.split(' ')[0]} is significant because it:`,
        `Which evidence from the passage most strongly supports the author's claim about ${topic.split(' ')[0]}?`,
        `The author's discussion of ${topic.split(' ')[0]} serves primarily to:`
      ],
      'very hard': [
        `The passage's argument about ${topic.split(' ')[0]} relies on which underlying assumption?`,
        `Which implication of the author's analysis of ${topic.split(' ')[0]} is most strongly suggested by the passage?`,
        `The author's treatment of ${topic.split(' ')[0]} can be described as:`
      ]
    };
    return questions[difficulty][Math.floor(Math.random() * questions[difficulty].length)];
  }

  function generateReadingOptions(difficulty, topic) {
    if (difficulty === 'medium') {
      return [
        `Presents the author's central argument about ${topic}`,
        `Misinterprets a minor detail from the passage`,
        `Describes an opposing viewpoint not addressed`,
        `States an irrelevant historical fact`
      ];
    } else if (difficulty === 'hard') {
      return [
        `Accurately reflects the passage's nuanced position`,
        `Oversimplifies the author's complex argument`,
        `Confuses correlation with causation as discussed`,
        `Applies the concept incorrectly to a different context`
      ];
    } else if (difficulty === 'very hard') {
      return [
        `Captures the passage's sophisticated theoretical framing`,
        `Misrepresents the author's methodological approach`,
        `Confuses empirical findings with normative claims`,
        `Fails to distinguish between different conceptual levels`
      ];
    }
    return [
      `Correct answer related to ${topic}`,
      `Contradicts the passage's main point`,
      `Is mentioned but not the primary focus`,
      `Is outside the scope of the passage`
    ];
  }

  function generateWritingPassage(difficulty, issue) {
    const passages = {
      'easy': {
        'subject-verb agreement': 'The students in the class is working on their project.',
        'pronoun reference': 'Each student must submit their own assignment, and they must be original.',
        'basic punctuation': 'The meeting was scheduled for Tuesday however it was cancelled.'
      },
      'medium': {
        'logical transitions': 'Many cities have invested in public transportation. These systems reduce traffic congestion. They also decrease air pollution. Maintaining these systems requires significant funding.',
        'word choice precision': 'The new policy had a good effect on employee morale.',
        'sentence structure': 'Walking down the street, the buildings were very tall and impressive.'
      },
      'hard': {
        'rhetorical effectiveness': 'The author makes a point about climate change. It is important. We should do something about it.',
        'tone consistency': 'The CEO was like, whatever, we do not care about the critics.',
        'evidence integration': 'Social media is bad. Many studies show this. It causes depression.'
      },
      'very hard': {
        'argumentative coherence': 'Capitalism has led to unprecedented prosperity. Therefore, all government regulation should be eliminated.',
        'sophisticated syntax': 'The theory, which was proposed by Smith, and later expanded upon by Marx, has been, despite numerous critiques, influential.',
        'theoretical framing': 'Postmodernism challenges traditional narratives. This is important. Historians should reconsider their methods.'
      }
    };
    return passages[difficulty]?.[issue] || passages.medium['logical transitions'];
  }

  function generateWritingOptions(difficulty, issue) {
    const options = {
      'easy': [
        `Corrects the ${issue} error`,
        `Creates a different grammatical error`,
        `Changes the meaning of the sentence`,
        `Is grammatically correct but less concise`
      ],
      'medium': [
        `Best improves the ${issue}`,
        `Grammatically correct but less effective`,
        `Changes the logical relationship`,
        `Introduces ambiguity`
      ],
      'hard': [
        `Most effectively strengthens the ${issue}`,
        `Stylistically awkward but grammatically correct`,
        `Weakens the author's argument`,
        `Shifts the focus inappropriately`
      ],
      'very hard': [
        `Best enhances the ${issue}`,
        `Sophisticated but slightly imprecise`,
        `Overly complex and unclear`,
        `Simplistic and ineffective`
      ]
    };
    return options[difficulty] || options.medium;
  }

  for (let i = 0; i < count; i++) {
    if (sectionType === 'reading') {
      const topic = readingTopics[difficulty][i % readingTopics[difficulty].length];
      
      questions.push({
        type: 'mcq',
        questionText: getReadingQuestionForDifficulty(difficulty, topic),
        passage: `This passage discusses ${topic}. It explores various aspects of this subject, considering ${difficulty === 'easy' ? 'basic' : difficulty === 'medium' ? 'important' : difficulty === 'hard' ? 'complex' : 'sophisticated'} dimensions and their implications. The author presents ${difficulty === 'easy' ? 'clear' : difficulty === 'medium' ? 'balanced' : difficulty === 'hard' ? 'nuanced' : 'multifaceted'} perspectives while maintaining focus on central themes relevant to SAT ${difficulty} level reading comprehension.`,
        options: generateReadingOptions(difficulty, topic),
        correctAnswer: 0,
        marks: 1,
        fromAI: false,
        sectionType: 'reading',
        difficulty: difficulty,
        verified: true
      });
    } else { // writing - FIXED: NO "NO CHANGE" OPTIONS
      const issueList = writingIssues[difficulty];
      const issue = issueList[i % issueList.length];
      
      questions.push({
        type: 'mcq',
        questionText: `Which choice best ${difficulty === 'easy' ? 'corrects' : difficulty === 'medium' ? 'improves' : difficulty === 'hard' ? 'strengthens' : 'enhances'} the ${issue} in the passage?`,
        passage: generateWritingPassage(difficulty, issue),
        options: generateWritingOptions(difficulty, issue),
        correctAnswer: 0,
        marks: 1,
        fromAI: false,
        sectionType: 'writing',
        difficulty: difficulty,
        verified: true
      });
    }
  }
  
  return questions;
}

// ==================== SECTION DETECTION ====================

function detectSections(fullText) {
  const normalized = fullText.replace(/\s+/g, ' ').toLowerCase();

  const sections = {
    reading: { start: 0, end: -1, content: '', header: '' },
    writing: { start: -1, end: -1, content: '', header: '' },
    math_no_calc: { start: -1, end: -1, content: '', header: '' },
    math_calc: { start: -1, end: -1, content: '', header: '' }
  };

  const keywords = [
    { type: 'reading', regex: /\breading\b|reading\s*&\s*writing/gi },
    { type: 'writing', regex: /\bwriting\b/gi },
    { type: 'math_no_calc', regex: /math[\s\-_]*(test)?[\s\-_]*(no[\s\-_]*calc(ulator)?)/gi },
    { type: 'math_calc', regex: /math[\s\-_]*(test)?[\s\-_]*(with[\s\-_]*calc(ulator)?|calc(ulator)?)/gi }
  ];

  const markers = [];
  keywords.forEach(({ type, regex }) => {
    let match;
    while ((match = regex.exec(normalized)) !== null) {
      markers.push({ type, index: match.index, length: match[0].length, header: match[0] });
    }
  });

  markers.sort((a, b) => a.index - b.index);

  markers.forEach((marker, i) => {
    const nextMarker = i < markers.length - 1 ? markers[i + 1] : null;
    sections[marker.type] = {
      start: marker.index,
      end: nextMarker ? nextMarker.index : fullText.length,
      content: fullText.slice(
        marker.index + marker.length,
        nextMarker ? nextMarker.index : fullText.length
      ).trim(),
      header: marker.header
    };
  });

  Object.keys(sections).forEach(type => {
    if (sections[type].start === -1) {
      sections[type] = {
        start: 0,
        end: fullText.length,
        content: fullText.trim(),
        header: 'Full PDF (fallback)'
      };
    }
  });

  console.log('Detected sections (lenient):');
  Object.entries(sections).forEach(([type, { start, header }]) => {
    console.log(`${type}: ${header ? header : 'Fallback (full PDF)'}`);
  });

  return sections;
}

// ==================== SAT MARKDOWN PARSER ====================

function parseSATMarkdownToQuestions(markdownText, sectionType) {
  const questions = [];
  const isMath = sectionType.includes('math');
  
  const blocks = markdownText.split(/(?=^Passage:\s*|^\d+\.\s)/mi);
  
  let currentPassage = '';

  for (const block of blocks) {
    const lines = block.trim().split('\n').map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    if (!isMath && /^Passage:\s*/i.test(lines[0])) {
      currentPassage = lines[0].replace(/^Passage:\s*/i, '').trim();
      for (let i = 1; i < lines.length; i++) {
        if (/^\d+\.\s/.test(lines[i])) break;
        currentPassage += ' ' + lines[i];
      }
      currentPassage = currentPassage.trim();
      continue;
    }

    const firstLineMatch = lines[0].match(/^(\d+)\.\s*(.+)$/);
    if (!firstLineMatch) continue;

    const questionText = firstLineMatch[2];
    const options = [];
    let correctAnswer = null;
    let type = isMath ? 'grid_in' : 'mcq';

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      
      const optionMatch = line.match(/^([A-D])\.\s*(.+)$/i);
      if (optionMatch) {
        options.push(optionMatch[2].trim());
        type = 'mcq';
        continue;
      }

      const answerMatch = line.match(/^Correct:\s*([A-D0-9\.\/\-]+)/i);
      if (answerMatch) {
        correctAnswer = answerMatch[1];
      }
    }

    if (type === 'mcq' && options.length === 4 && correctAnswer !== null) {
      questions.push({
        type: 'mcq',
        questionText,
        passage: !isMath ? currentPassage : '',
        options,
        correctAnswer: ['A', 'B', 'C', 'D'].indexOf(correctAnswer.toUpperCase()),
        marks: 1,
        fromAI: false
      });
    } else if (type === 'grid_in' && correctAnswer) {
      questions.push({
        type: 'grid_in',
        questionText,
        passage: '',
        correctAnswer: String(correctAnswer),
        marks: 1,
        fromAI: false
      });
    }
  }

  console.log(`✅ Parsed ${questions.length} questions from SAT Markdown for ${sectionType}`);
  return questions;
}

// ==================== QUESTION PARSING ====================

function parseReadingWritingQuestions(sectionText) {
  const questions = [];

  if (!sectionText || !sectionText.trim()) return questions;

  const text = '\n' + sectionText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const qMatches = Array.from(text.matchAll(/\n\s*(\d+)\.\s/g));

  if (qMatches.length === 0) {
    console.log('⚠️ parseReadingWritingQuestions: No numbered questions found');
    return questions;
  }

  const findLastPassageBefore = (idx) => {
    const prefix = text.slice(0, idx);
    const lower = prefix.toLowerCase();
    const pIdx = lower.lastIndexOf('passage');
    if (pIdx === -1) return null;

    let passageRaw = prefix.slice(pIdx, idx);
    passageRaw = passageRaw.replace(/passage\s*\d*[:\-\s]*/i, '').trim();
    return passageRaw.length ? passageRaw.replace(/\n\s*/g, ' ').trim() : null;
  };

  for (let i = 0; i < qMatches.length; i++) {
    const startIndex = qMatches[i].index;
    const endIndex = i + 1 < qMatches.length ? qMatches[i + 1].index : text.length;
    const block = text.slice(startIndex, endIndex).trim();

    if (!block) continue;

    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;

    const qMatch = lines[0].match(/^\d+\.\s*(.+)/);
    if (!qMatch) continue;

    const questionText = qMatch[1].trim();
    const options = [];
    let correctAnswer = null;

    for (let j = 1; j < lines.length; j++) {
      const line = lines[j];

      const optMatch = line.match(/^([A-D])[\.\)]\s*(.+)/i);
      if (optMatch) {
        options.push(optMatch[2].trim());
        continue;
      }

      const ansMatch = line.match(/Correct[:\-]?\s*([A-D])/i);
      if (ansMatch) {
        correctAnswer = ['A','B','C','D'].indexOf(ansMatch[1].toUpperCase());
      }
    }

    let passage = findLastPassageBefore(startIndex);
    if (!passage) passage = '';

    if (options.length === 4 && correctAnswer !== null) {
      questions.push({
        type: 'mcq',
        questionText,
        passage,
        options,
        correctAnswer,
        marks: 1
      });
    } else {
      if (correctAnswer === null) {
        const ansLine = lines.find(l => /Correct[:\-]?\s*([0-9\.\-\/A-Za-z]+)/i.test(l));
        const ansVal = ansLine ? (ansLine.match(/Correct[:\-]?\s*([0-9\.\-\/A-Za-z]+)/i)[1]) : null;
        if (ansVal) {
          questions.push({
            type: 'grid_in',
            questionText,
            passage,
            correctAnswer: String(ansVal).trim(),
            marks: 1
          });
        }
      }
    }
  }

  console.log(`📘 Parsed ${questions.length} reading/writing questions (with passages where found)`);
  return questions;
}

function parseMathQuestions(sectionText, sectionType) {
  const questions = [];
  
  const questionBlocks = sectionText.split(/(?=\d+\.\s)/g);
  
  questionBlocks.forEach(block => {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length < 2) return;

    const qMatch = lines[0].match(/^(\d+)\.\s*(.+)/);
    if (!qMatch) return;

    const questionText = qMatch[2];
    const options = [];
    let correctAnswer = null;

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      
      const optMatch = line.match(/^([A-D])[\.\)]\s*(.+)/i);
      if (optMatch) {
        options.push(optMatch[2]);
        continue;
      }

      const ansMatch = line.match(/Correct[:\-]?\s*([A-D0-9\.\/]+)/i);
      if (ansMatch) {
        correctAnswer = ansMatch[1];
      }
    }

    if (options.length === 4 && correctAnswer !== null) {
      questions.push({
        type: 'mcq',
        questionText,
        options,
        correctAnswer: ['A', 'B', 'C', 'D'].indexOf(correctAnswer.toUpperCase()),
        marks: 1
      });
    } else if (correctAnswer) {
      questions.push({
        type: 'grid_in',
        questionText,
        correctAnswer: String(correctAnswer),
        marks: 1
      });
    }
  });

  console.log(`🧮 Parsed ${questions.length} ${sectionType} questions`);
  return questions;
}

// ==================== MATH-FIRST GENERATION ====================

async function generateMathQuestions(sectionType, difficulty, count) {
  console.log(`🔢 MATH-FIRST: Generating ${count} ${difficulty} questions for ${sectionType}`);
  
  const mathGenerator = new SATMathGenerator(sectionType, difficulty);
  const questions = [];
  
  for (let i = 0; i < count; i++) {
    try {
      const mathQuestion = mathGenerator.generateMathQuestion();
      
      const correctValue = mathQuestion.correctAnswer;
      const correctFormatted = mathGenerator.formatAnswer(correctValue);
      
      let correctIndex = -1;
      
      for (let j = 0; j < mathQuestion.options.length; j++) {
        const option = mathQuestion.options[j];
        if (mathGenerator.areAnswersEqual(option, correctFormatted)) {
          correctIndex = j;
          break;
        }
      }
      
      if (correctIndex === -1) {
        console.warn(`⚠️ Question ${i+1}: Correct answer "${correctFormatted}" not found in options:`, mathQuestion.options);
        
        const correctNum = mathGenerator.parseNumber(correctValue);
        
        for (let j = 0; j < mathQuestion.options.length; j++) {
          const option = mathQuestion.options[j];
          const optionNum = mathGenerator.parseNumber(option);
          
          if (!isNaN(correctNum) && !isNaN(optionNum) && Math.abs(optionNum - correctNum) < 0.001) {
            correctIndex = j;
            console.log(`✅ Found numeric match at index ${j}: ${option} ≈ ${correctValue}`);
            break;
          }
        }
        
        if (correctIndex === -1) {
          const optionsAsNumbers = mathQuestion.options.map(opt => mathGenerator.parseNumber(opt));
          const correctAsNumber = mathGenerator.parseNumber(correctValue);
          
          for (let j = 0; j < optionsAsNumbers.length; j++) {
            if (!isNaN(optionsAsNumbers[j]) && !isNaN(correctAsNumber) && 
                Math.abs(optionsAsNumbers[j] - correctAsNumber) < 0.001) {
              correctIndex = j;
              console.log(`✅ Found decimal match at index ${j}`);
              break;
            }
          }
        }
        
        if (correctIndex === -1) {
          console.error(`❌ CRITICAL: Correct answer "${correctFormatted}" completely missing from options!`);
          mathQuestion.options[0] = correctFormatted;
          correctIndex = 0;
        }
      }
      
      if (correctIndex >= 0 && correctIndex < mathQuestion.options.length) {
        const selectedOption = mathQuestion.options[correctIndex];
        if (!mathGenerator.areAnswersEqual(selectedOption, correctFormatted)) {
          console.error(`❌ VERIFICATION FAILED: Index ${correctIndex} option "${selectedOption}" doesn't match correct "${correctFormatted}"`);
          
          for (let j = 0; j < mathQuestion.options.length; j++) {
            if (mathGenerator.areAnswersEqual(mathQuestion.options[j], correctFormatted)) {
              correctIndex = j;
              console.log(`✅ Fixed: Correct answer at index ${j}`);
              break;
            }
          }
        }
      }
      
      questions.push({
        type: 'mcq',
        questionText: mathQuestion.questionText,
        options: mathQuestion.options,
        correctAnswer: correctIndex,
        marks: 1,
        fromAI: false,
        verified: true,
        templateType: mathQuestion.templateType || 'unknown',
        difficulty: difficulty,
        sectionType: sectionType
      });
      
      if ((i + 1) % 5 === 0) {
        const q = questions[questions.length - 1];
        console.log(`   Generated ${i + 1}/${count} - Correct index: ${q.correctAnswer}, Answer: ${mathQuestion.options[q.correctAnswer]}`);
      }
      
    } catch (err) {
      console.error(`❌ Error generating math question ${i+1}:`, err.message);
      
      const a = i + 2;
      const b = i + 3;
      const product = a * b;
      
      questions.push({
        type: 'mcq',
        questionText: `If x * y = ${product} and x = ${a}, what is the value of y?`,
        options: [
          b.toString(),
          (b + 1).toString(),
          (b - 1).toString(),
          (a + b).toString()
        ],
        correctAnswer: 0,
        marks: 1,
        fromAI: false,
        verified: true,
        templateType: 'sat_fallback',
        difficulty: difficulty,
        sectionType: sectionType
      });
    }
  }
  
  console.log(`\n🔍 VALIDATING ${questions.length} math questions...`);
  let errorCount = 0;
  
  questions.forEach((q, idx) => {
    if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
      errorCount++;
      console.error(`❌ Question ${idx+1}: INVALID index ${q.correctAnswer} (options: ${q.options.length})`);
    }
    
    if (q.templateType === 'sat_fallback') {
      const match = q.questionText.match(/If x \* y = (\d+) and x = (\d+), what is the value of y\?/);
      if (match) {
        const product = parseInt(match[1]);
        const x = parseInt(match[2]);
        const correctY = product / x;
        const selectedAnswer = q.options[q.correctAnswer];
        
        if (parseInt(selectedAnswer) !== correctY) {
          errorCount++;
          console.error(`❌ Question ${idx+1}: MATH ERROR ${product}/${x}=${correctY}, but selected: ${selectedAnswer}`);
        }
      }
    }
  });
  
  if (errorCount > 0) {
    console.error(`❌ FOUND ${errorCount} ERRORS in math questions! Attempting to fix...`);
    
    questions.forEach((q, idx) => {
      if (q.correctAnswer < 0 || q.correctAnswer >= q.options.length) {
        q.correctAnswer = 0;
        console.log(`   Fixed question ${idx+1}: Set correctAnswer to 0`);
      }
    });
  } else {
    console.log(`✅ ALL ${questions.length} math questions VALIDATED successfully!`);
  }
  
  return questions;
}

// ==================== FIXED: READING/WRITING GENERATION WITH NO "NO CHANGE" ====================

async function generateReadingWritingQuestions(originalQuestions, sectionType, difficulty = 'medium', questionCount) {
  const isMath = sectionType.includes('math');
  if (isMath) return [];

  console.log(`📚 Starting ${sectionType} generation (${questionCount} questions, ${difficulty} difficulty)`);

  const difficultyPrompts = {
    'easy': {
      reading: `Generate SHORT, STRAIGHTFORWARD SAT reading passages (50-100 words maximum) from literature, history, or science. Each passage should have a CLEAR main idea. Questions should test BASIC comprehension and vocabulary in context.`,
      writing: `Generate SHORT paragraphs (3-4 sentences) with ONE clear grammar, punctuation, or basic usage error. Questions should be SIMPLE corrections of subject-verb agreement, pronoun reference, or basic punctuation.`
    },
    'medium': {
      reading: `Generate STANDARD SAT reading passages (100-200 words) with a clear argument or narrative. Include 1-2 inference questions or vocabulary in context. Passages should be from literature, social studies, or science.`,
      writing: `Generate MEDIUM paragraphs with transition/logic errors or word choice issues. Questions should test organization, logical flow, or precise word choice in standard SAT writing questions.`
    },
    'hard': {
      reading: `Generate CHALLENGING SAT reading passages (200-300 words) with nuanced arguments or paired information. Questions should test evidence evaluation, rhetorical analysis, and complex inference.`,
      writing: `Generate COMPLEX paragraphs with multiple issues or sophisticated rhetorical problems. Questions should test rhetorical effectiveness, tone/style, or advanced grammar rules.`
    },
    'very hard': {
      reading: `Generate ADVANCED SAT reading passages (300+ words) or PAIRED PASSAGES comparing perspectives. Questions should test synthesis, complex analysis, and evidence-based reasoning at the highest SAT level.`,
      writing: `Generate ACADEMIC paragraphs with multiple sophisticated issues. Questions should test logical organization, evidence integration, and advanced rhetorical strategies.`
    }
  };

  const sectionSpecific = sectionType === 'reading' 
    ? `Generate SAT READING ${difficultyPrompts[difficulty].reading}`
    : `Generate SAT WRITING questions with these CRITICAL requirements:

**ABSOLUTELY FORBIDDEN:**
- ❌ NEVER include "NO CHANGE" as an option - this is poor SAT question design
- ❌ NEVER make option A the correct answer just because it's the original text
- ❌ NEVER repeat the same question pattern

**REQUIRED:**
- ✅ All 4 options must be DIFFERENT, plausible revisions
- ✅ Each option should be a complete, grammatically correct alternative
- ✅ Vary question types: sentence combining, word choice, transitions, concision, parallelism, modifier placement
- ✅ Correct answer should be a clear improvement over the original

**EXAMPLE FORMAT (NO "NO CHANGE"):**
Passage: The committee have decided to postpone the vote until next week.

1. Which choice corrects the subject-verb agreement error?
A. committee has decided
B. committee, they have decided
C. committee; having decided
D. committee deciding
Correct: A`;

  const prompt = `
You are an expert SAT ${sectionType.toUpperCase()} test writer. Generate ${questionCount} NEW ${difficulty} difficulty SAT ${sectionType} passages with questions.

CRITICAL: Questions MUST match ACTUAL SAT ${difficulty.toUpperCase()} level:
- "easy": Basic comprehension, vocabulary in context, simple grammar rules
- "medium": Standard inference, passage organization, common grammar rules  
- "hard": Complex inference, rhetorical analysis, evidence evaluation
- "very hard": Paired passages, synthesis, advanced rhetorical strategies

${sectionSpecific}

**FORMATTING RULES (MUST FOLLOW EXACTLY):**
1. Start EACH passage with exactly: "Passage: [text]"
2. After each passage, add EXACTLY 1 question in this format:
   1. [Question text?]
   A. [Option A]
   B. [Option B]
   C. [Option C]
   D. [Option D]
   Correct: [A/B/C/D]

3. For "very hard" reading: You may include TWO passages and comparative questions.

4. IMPORTANT: Generate ALL ${questionCount} passages and questions in one response.

**EXAMPLES for ${difficulty} level:**

${getExampleForDifficulty(sectionType, difficulty)}

Now generate ${questionCount} new SAT ${difficulty} ${sectionType} passage+question pairs in the EXACT format above.`;

  try {
    console.log(`⏳ Calling AWS Bedrock for ${sectionType} (${difficulty})...`);
    
    const response = await withTimeout(
      bedrockClient.send(new InvokeModelCommand({
        modelId: 'mistral.mistral-large-2402-v1:0',
        body: JSON.stringify({
          prompt,
          max_tokens: 4096,
          temperature: 0.6,
          top_p: 0.9
        })
      })),
      120000,
      `AWS Bedrock timeout for ${sectionType}`
    );

    const generatedText = JSON.parse(new TextDecoder().decode(response.body)).outputs[0].text;
    
    console.log(`✅ AWS response received for ${sectionType}, parsing...`);
    
    const questions = parseGeneratedReadingWriting(generatedText, sectionType, difficulty, questionCount);
    
    console.log(`✅ Parsed ${questions.length} questions from AWS for ${sectionType}`);
    
    if (questions.length < questionCount) {
      const needed = questionCount - questions.length;
      console.log(`⚠️ Only got ${questions.length}/${questionCount} questions, generating ${needed} SAT fallbacks`);
      
      const fallbackQuestions = generateSATFallbackReadingWriting(sectionType, difficulty, needed);
      questions.push(...fallbackQuestions);
    }
    
    console.log(`✅ Total: Generated ${questions.length} ${sectionType} questions (${difficulty})`);
    return questions.slice(0, questionCount);
    
  } catch (err) {
    console.error(`❌ AWS generation failed for ${sectionType}:`, err.message);
    console.log(`🔄 Generating ${questionCount} ${sectionType} questions locally as SAT fallback`);
    return generateSATFallbackReadingWriting(sectionType, difficulty, questionCount);
  }
}

// ==================== MAIN GENERATION FUNCTION ====================

async function generateAIQuestions(originalQuestions, sectionType, difficulty = 'medium') {
  const isMath = sectionType.includes('math');
  const questionCount = isMath ? 20 : 25;
  
  console.log(`🎯 Generating ${questionCount} ${sectionType} questions (${difficulty})`);
  
  if (isMath) {
    return await generateMathQuestions(sectionType, difficulty, questionCount);
  } else {
    return await generateReadingWritingQuestions(originalQuestions, sectionType, difficulty, questionCount);
  }
}

// ==================== MAIN FUNCTIONS ====================

async function parseSATAssessment(fileBuffer, sectionType, difficulty = 'medium', fileType = 'pdf') {
  try {
    console.log(`\n📄 STARTING: SAT ${fileType.toUpperCase()} - ${sectionType} (${difficulty})`);
    
    let originalQuestions = [];
    
    if (fileType === 'markdown') {
      const markdownText = fileBuffer.toString('utf8');
      originalQuestions = parseSATMarkdownToQuestions(markdownText, sectionType);
    } else {
      const data = await pdf(fileBuffer);
      const sections = detectSections(data.text);

      if (!sections[sectionType] || sections[sectionType].start === -1) {
        console.warn(`⚠️ Section not found: ${sectionType}. Using full PDF as fallback.`);
        sections[sectionType] = { start: 0, end: data.text.length, content: data.text, header: 'Full PDF (fallback)' };
      }

      if (sectionType === 'reading' || sectionType === 'writing') {
        originalQuestions = parseReadingWritingQuestions(sections[sectionType].content);
      } else {
        originalQuestions = parseMathQuestions(sections[sectionType].content, sectionType);
      }
    }

    console.log(`📊 Found ${originalQuestions.length} original questions`);

    const aiQuestions = await generateAIQuestions(originalQuestions, sectionType, difficulty);
    
    console.log(`✅ COMPLETED: Generated ${aiQuestions.length} ${sectionType} questions`);
    return aiQuestions;
  } catch (err) {
    console.error(`❌ Error parsing ${fileType.toUpperCase()} ${sectionType}:`, err);
    return [];
  }
}

async function parseSATAssessmentCombined(fileBuffer, difficulty = 'medium', fileType = 'pdf') {
  console.log(`\n🚀 STARTING COMBINED ASSESSMENT GENERATION (${difficulty})`);
  
  try {
    let sections = {};
    
    if (fileType === 'markdown') {
      const markdownText = fileBuffer.toString('utf8');
      sections = {
        reading: { content: markdownText },
        writing: { content: markdownText },
        math_no_calc: { content: markdownText },
        math_calc: { content: markdownText }
      };
    } else {
      const data = await pdf(fileBuffer);
      sections = detectSections(data.text);
    }

    const sectionTypes = ['reading', 'writing', 'math_no_calc', 'math_calc'];
    let allQuestions = [];

    for (const sectionType of sectionTypes) {
      console.log(`\n🔁 PROCESSING: ${sectionType.toUpperCase()} section`);
      
      let originalQuestions = [];
      if (sectionType === 'reading' || sectionType === 'writing') {
        originalQuestions = parseReadingWritingQuestions(sections[sectionType].content);
      } else {
        originalQuestions = parseMathQuestions(sections[sectionType].content, sectionType);
      }

      console.log(`📊 Found ${originalQuestions.length} original ${sectionType} questions`);
      
      try {
        const aiQuestions = await withTimeout(
          generateAIQuestions(originalQuestions, sectionType, difficulty),
          180000,
          `Timeout generating ${sectionType} questions`
        );
        
        if (aiQuestions.length > 0) {
          console.log(`✅ GENERATED: ${aiQuestions.length} ${sectionType} questions`);
          allQuestions = allQuestions.concat(aiQuestions);
        } else {
          console.warn(`⚠️ No questions generated for ${sectionType}`);
          const questionCount = sectionType.includes('math') ? 20 : 25;
          console.log(`🔄 Generating ${questionCount} local ${sectionType} questions`);
          
          for (let i = 0; i < questionCount; i++) {
            allQuestions.push({
              type: 'mcq',
              questionText: `SAT ${sectionType} question ${i+1}`,
              passage: sectionType.includes('math') ? '' : 'This is a sample SAT passage for testing purposes.',
              options: ['Option A', 'Option B', 'Option C', 'Option D'],
              correctAnswer: 0,
              marks: 1,
              fromAI: false,
              sectionType: sectionType,
              difficulty: difficulty
            });
          }
        }
      } catch (timeoutErr) {
        console.error(`❌ ${timeoutErr.message}`);
        const questionCount = sectionType.includes('math') ? 20 : 25;
        console.log(`🔄 Generating ${questionCount} emergency ${sectionType} questions`);
        
        for (let i = 0; i < questionCount; i++) {
          allQuestions.push({
            type: 'mcq',
            questionText: `SAT ${sectionType} question ${i+1}`,
            passage: sectionType.includes('math') ? '' : 'Sample passage for emergency fallback.',
            options: ['Choice A', 'Choice B', 'Choice C', 'Choice D'],
            correctAnswer: 0,
            marks: 1,
            fromAI: false,
            sectionType: sectionType,
            difficulty: difficulty
          });
        }
      }
    }

    console.log(`\n🎉 COMPLETED: Generated ${allQuestions.length} total questions`);
    console.log(`📊 Breakdown:`);
    console.log(`   Reading: ${allQuestions.filter(q => q.sectionType === 'reading').length}`);
    console.log(`   Writing: ${allQuestions.filter(q => q.sectionType === 'writing').length}`);
    console.log(`   Math (No Calc): ${allQuestions.filter(q => q.sectionType === 'math_no_calc').length}`);
    console.log(`   Math (Calc): ${allQuestions.filter(q => q.sectionType === 'math_calc').length}`);
    
    return allQuestions;
  } catch (err) {
    console.error('❌ Error parsing combined assessment:', err);
    return [];
  }
}

module.exports = {
  parseSATAssessment,
  parseSATAssessmentCombined,
  generateMathQuestions
};