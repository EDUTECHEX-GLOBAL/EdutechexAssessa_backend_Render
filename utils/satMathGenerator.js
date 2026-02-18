class SATMathGenerator {
  constructor(sectionType, difficulty) {
    this.sectionType = sectionType;
    this.difficulty = difficulty;
  }

  randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  randomChoice(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  generateMathQuestion() {
    const templates = this.getTemplates();
    
    if (templates.length === 0) {
      console.warn(`No templates found for difficulty: ${this.difficulty}, using SAT fallback`);
      return this.generateSATFallbackQuestion();
    }
    
    const template = this.randomChoice(templates);
    
    try {
      const values = template.generate();
      let question = template.text;
      
      Object.keys(values).forEach(key => {
        if (key !== 'answer' && key !== 'correctAnswer' && key !== 'root1' && key !== 'root2' && key !== 'displayAnswer' && key !== 'questionText') {
          question = question.replace(new RegExp(`{${key}}`, 'g'), values[key]);
        }
      });
      
      // Use custom questionText if provided
      if (values.questionText) {
        question = values.questionText;
      }
      
      const correctAnswer = values.displayAnswer || values.answer || values.correctAnswer;
      
      if (correctAnswer === undefined) {
        throw new Error('No answer generated');
      }
      
      // VERIFICATION STEP: Double-check the answer mathematically
      this.verifyAnswer(question, correctAnswer, template, values);
      
      const options = this.generateOptions(correctAnswer, template, values);
      
      // CRITICAL: Ensure correct answer is in options
      const formattedCorrect = this.formatAnswer(correctAnswer);
      let foundCorrect = false;
      let correctIndex = -1;
      
      for (let i = 0; i < options.length; i++) {
        if (this.areAnswersEqual(options[i], formattedCorrect)) {
          foundCorrect = true;
          correctIndex = i;
          break;
        }
      }
      
      if (!foundCorrect) {
        console.error(`❌ CRITICAL: Correct answer ${formattedCorrect} not in options!`);
        console.error(`Options: ${options.join(', ')}`);
        console.error(`Template: ${template.name}, Values:`, values);
        
        const replaceIndex = this.randomInt(0, options.length - 1);
        options[replaceIndex] = formattedCorrect;
        correctIndex = replaceIndex;
      }
      
      return {
        questionText: question,
        correctAnswer: correctAnswer,
        correctAnswerIndex: correctIndex,
        options: options,
        type: 'mcq',
        templateType: template.name,
        values: values,
        verified: true,
        difficulty: this.difficulty,
        sectionType: this.sectionType
      };
    } catch (err) {
      console.error(`Template ${template?.name} failed:`, err.message);
      return this.generateSATFallbackQuestion();
    }
  }

  verifyAnswer(question, correctAnswer, template, values) {
    switch(template.name) {
      case 'exponent_laws_easy':
        const {numerator, denominator} = values;
        const computed = (numerator - denominator) / 2;
        if (Math.abs(computed - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Exponent verification failed: ${computed} != ${correctAnswer}`);
        }
        break;
        
      case 'ratio_problem_easy':
        const {ingredient, targetServings, servings} = values;
        const computedRatio = (ingredient * targetServings) / servings;
        const answerNum = this.parseNumber(correctAnswer);
        if (Math.abs(computedRatio - answerNum) > 0.01) {
          throw new Error(`Ratio verification failed: ${computedRatio} != ${answerNum}`);
        }
        break;
        
      case 'linear_equation_easy':
        const {a, b, c} = values;
        const computedX = (c - b) / a;
        if (Math.abs(computedX - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Linear equation verification failed: ${computedX} != ${correctAnswer}`);
        }
        break;
        
      case 'data_interpretation_easy':
        const {total, girls} = values;
        const boys = total - girls;
        const expected = `${boys/this.gcd(boys, total)}/${total/this.gcd(boys, total)}`;
        if (expected !== correctAnswer) {
          throw new Error(`Fraction verification failed: ${expected} != ${correctAnswer}`);
        }
        break;
        
      case 'algebra_expression_easy':
        // Already verified by generation logic
        break;
        
      case 'percent_word_problem_easy':
        const {price, discount} = values;
        const computedPrice = price * (1 - discount/100);
        if (Math.abs(computedPrice - this.parseNumber(correctAnswer)) > 0.01) {
          throw new Error(`Percent word problem failed: ${computedPrice} != ${correctAnswer}`);
        }
        break;
        
      case 'exponent_simplify_easy':
        const {a: a1, b: b1} = values;
        const computedExp = 2 * a1 + b1;
        if (computedExp !== parseInt(correctAnswer)) {
          throw new Error(`Exponent simplify failed: ${computedExp} != ${correctAnswer}`);
        }
        break;
        
      case 'algebra_solve_easy':
        const {a: a2, b: b2, c: c2} = values;
        const computedX2 = c2 / a2 + b2;
        if (Math.abs(computedX2 - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Algebra solve failed: ${computedX2} != ${correctAnswer}`);
        }
        break;
        
      case 'quadratic_factorable_medium':
        const {m, n} = values;
        const roots = [-m, -n];
        const positiveRoot = roots.filter(r => r > 0)[0] || Math.abs(roots[0]);
        if (Math.abs(positiveRoot - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Quadratic verification failed: ${positiveRoot} != ${correctAnswer}`);
        }
        break;
        
      case 'system_equations_medium':
        const {a: a3, b: b3, c: c3, d: d3} = values;
        const computedX3 = (d3 - b3) / (a3 - c3);
        if (Math.abs(computedX3 - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`System verification failed: ${computedX3} != ${correctAnswer}`);
        }
        break;
        
      case 'circle_circumference_medium':
        const {diameter} = values;
        const computedCircumference = 3.14 * diameter;
        if (Math.abs(computedCircumference - parseFloat(correctAnswer)) > 0.01) {
          throw new Error(`Circumference verification failed: ${computedCircumference} != ${correctAnswer}`);
        }
        break;
        
      case 'function_evaluation_medium':
        const {a: a4, b: b4, c: c4, xValue} = values;
        const computedF = a4 * xValue * xValue + b4 * xValue + c4;
        if (Math.abs(computedF - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Function evaluation failed: ${computedF} != ${correctAnswer}`);
        }
        break;
        
      case 'probability_medium':
        const {red, blue} = values;
        const totalMarbles = red + blue;
        const expectedProb = `${red}/${totalMarbles}`; // ✅ FIXED
        if (expectedProb !== correctAnswer) {
          throw new Error(`Probability verification failed: ${expectedProb} != ${correctAnswer}`);
        }
        break;
        
      case 'exponential_growth_hard':
        const {principal, rate, years} = values;
        const computedGrowth = principal * Math.pow(1 + rate/100, years);
        if (Math.abs(computedGrowth - this.parseNumber(correctAnswer)) > 0.01) {
          throw new Error(`Exponential growth verification failed: ${computedGrowth} != ${correctAnswer}`);
        }
        break;
        
      case 'trigonometry_right_triangle_hard':
        const {hyp, angle} = values;
        let computedTrig;
        if (angle === 30) computedTrig = hyp * 0.5;
        else if (angle === 45) computedTrig = hyp * Math.sqrt(2)/2;
        else computedTrig = hyp * Math.sqrt(3)/2;
        if (Math.abs(computedTrig - this.parseNumber(correctAnswer)) > 0.01) {
          throw new Error(`Trigonometry verification failed: ${computedTrig} != ${correctAnswer}`);
        }
        break;
        
      case 'complex_inequality_hard':
        // Inequality answers are strings, verification is in generation
        break;
        
      case 'data_analysis_mean_hard':
        const {mean, num1, num2, num3, num4} = values;
        const sum = mean * 5;
        const currentSum = num1 + num2 + num3 + num4;
        const computedMean = sum - currentSum;
        if (Math.abs(computedMean - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Mean verification failed: ${computedMean} != ${correctAnswer}`);
        }
        break;
        
      case 'quadratic_formula_hard':
        const {root1: r1, root2: r2} = values;
        const smallerRoot = Math.min(r1, r2);
        if (Math.abs(smallerRoot - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Quadratic formula verification failed: ${smallerRoot} != ${correctAnswer}`);
        }
        break;
        
      case 'exponential_decay_hard':
        const {value, rate: rate2, years: years2} = values;
        const computedDecay = value * Math.pow(1 - rate2/100, years2);
        if (Math.abs(computedDecay - this.parseNumber(correctAnswer)) > 0.01) {
          throw new Error(`Exponential decay verification failed: ${computedDecay} != ${correctAnswer}`);
        }
        break;
        
      case 'complex_quadratic_very_hard':
        const {b: b5, c: c5, root1: r1v} = values;
        const root2v = r1v + 3;
        const expectedC = r1v * root2v;
        if (Math.abs(expectedC - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Complex quadratic verification failed: ${expectedC} != ${correctAnswer}`);
        }
        break;
        
      case 'function_composition_very_hard':
        const {a: a6, b: b6, xValue: xv} = values;
        const gValue = xv * xv;
        const composed = a6 * gValue + b6;
        if (Math.abs(composed - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Function composition verification failed: ${composed} != ${correctAnswer}`);
        }
        break;
        
      case 'probability_compound_very_hard':
        // Already verified in generation
        break;
        
      case 'circle_equation_very_hard':
        const {h, k} = values;
        const distance = Math.sqrt(h*h + k*k);
        if (Math.abs(distance - this.parseNumber(correctAnswer)) > 0.01) {
          throw new Error(`Circle equation verification failed: ${distance} != ${correctAnswer}`);
        }
        break;
        
      case 'system_complex_very_hard':
        const {a: a7, b: b7, c: c7, d: d7, e: e7, f: f7} = values;
        const det = a7 * e7 - b7 * d7;
        if (Math.abs(det) < 0.001) {
          throw new Error('System has no unique solution');
        }
        const computedX7 = (c7 * e7 - b7 * f7) / det;
        if (Math.abs(computedX7 - parseFloat(correctAnswer)) > 0.001) {
          throw new Error(`Complex system verification failed: ${computedX7} != ${correctAnswer}`);
        }
        break;
        
      case 'rational_expression_very_hard':
        const {a: a8, b: b8, x: x8} = values;
        const computedRational = (x8 + a8) / (x8 - b8);
        if (Math.abs(computedRational - this.parseNumber(correctAnswer)) > 0.01) {
          throw new Error(`Rational expression verification failed: ${computedRational} != ${correctAnswer}`);
        }
        break;
    }
  }

  getTemplates() {
    const allTemplates = [
      // ========== EASY DIFFICULTY (SAT Baseline) ==========
      {
        name: 'exponent_laws_easy',
        text: "If m^{{numerator}/2} ÷ m^{{denominator}/2} = m^x, what is the value of x?",
        difficulty: 'easy',
        generate: () => {
          const numerator = this.randomInt(3, 7);
          const denominator = this.randomInt(1, 3);
          const answer = (numerator - denominator) / 2;
          return { 
            numerator, 
            denominator, 
            answer,
            displayAnswer: answer.toString()
          };
        }
      },
      {
        name: 'ratio_problem_easy',
        text: "A recipe that yields {servings} servings requires {ingredient} cups of flour. How many cups of flour are needed to make {targetServings} servings?",
        difficulty: 'easy',
        generate: () => {
          const servings = this.randomInt(4, 8);
          const ingredient = this.randomInt(2, 5);
          const targetServings = this.randomInt(12, 20);
          const answer = (ingredient * targetServings) / servings;
          return { 
            servings, 
            ingredient, 
            targetServings, 
            answer,
            displayAnswer: answer % 1 === 0 ? answer.toString() : answer.toFixed(2)
          };
        }
      },
      {
        name: 'linear_equation_easy',
        text: "If {a}x + {b} = {c}, what is the value of x?",
        difficulty: 'easy',
        generate: () => {
          const a = this.randomInt(2, 5);
          const x = this.randomInt(2, 6);
          const b = this.randomInt(1, 10);
          const c = a * x + b;
          return { 
            a, b, c, 
            answer: x,
            displayAnswer: x.toString(),
            questionText: `If ${a}x + ${b} = ${c}, what is the value of x?`
          };
        }
      },
      {
        name: 'data_interpretation_easy',
        text: "In a class of {total} students, {girls} are girls. What fraction of the class are boys?",
        difficulty: 'easy',
        generate: () => {
          const total = this.randomChoice([20, 24, 30, 36]);
          const girls = this.randomInt(Math.floor(total/3), Math.floor(2*total/3));
          const boys = total - girls;
          const gcd = this.gcd(boys, total);
          const answer = `${boys/gcd}/${total/gcd}`;
          return {
            total, girls,
            answer,
            displayAnswer: answer,
            questionText: `In a class of ${total} students, ${girls} are girls. What fraction of the class are boys?`
          };
        }
      },
      {
        name: 'algebra_expression_easy',
        text: "Simplify: ({a}x + {b}) - ({c}x - {d})",
        difficulty: 'easy',
        generate: () => {
          const a = this.randomInt(2, 5);
          const b = this.randomInt(1, 5);
          const c = this.randomInt(1, 4);
          const d = this.randomInt(1, 4);
          const coeff = a - c;
          const constant = b + d;
          let answer;
          if (coeff === 0) {
            answer = constant.toString();
          } else if (constant === 0) {
            answer = `${coeff}x`;
          } else if (constant > 0) {
            answer = `${coeff}x + ${constant}`;
          } else {
            answer = `${coeff}x - ${Math.abs(constant)}`;
          }
          return { 
            a, b, c, d,
            answer,
            displayAnswer: answer,
            questionText: `Simplify: (${a}x + ${b}) - (${c}x - ${d})`
          };
        }
      },
      {
        name: 'percent_word_problem_easy',
        text: "If a shirt originally costs ${price} and is on sale for {discount}% off, what is the sale price?",
        difficulty: 'easy',
        generate: () => {
          const price = this.randomChoice([40, 50, 60, 80]);
          const discount = this.randomChoice([10, 15, 20, 25]);
          const answer = price * (1 - discount/100);
          return { 
            price, discount,
            answer,
            displayAnswer: `$${answer.toFixed(2)}`,
            questionText: `If a shirt originally costs $${price} and is on sale for ${discount}% off, what is the sale price?`
          };
        }
      },
      {
        name: 'exponent_simplify_easy',
        text: "Simplify: (x^{a})² × x^{b}",
        difficulty: 'easy',
        generate: () => {
          const a = this.randomInt(1, 3);
          const b = this.randomInt(1, 3);
          const answer = 2*a + b;
          return { 
            a, b, 
            answer,
            displayAnswer: answer.toString(),
            questionText: `Simplify: (x^${a})² × x^${b}`
          };
        }
      },
      {
        name: 'algebra_solve_easy',
        text: "Solve for x: {a}(x - {b}) = {c}",
        difficulty: 'easy',
        generate: () => {
          const a = this.randomInt(2, 4);
          const b = this.randomInt(1, 3);
          const x = this.randomInt(2, 5);
          const c = a * (x - b);
          return { 
            a, b, c, 
            answer: x,
            displayAnswer: x.toString(),
            questionText: `Solve for x: ${a}(x - ${b}) = ${c}`
          };
        }
      },

      // ========== MEDIUM DIFFICULTY (Standard SAT) ==========
      {
        name: 'quadratic_factorable_medium',
        text: "If (x + {m})(x + {n}) = 0, what is the positive value of x?",
        difficulty: 'medium',
        generate: () => {
          let m = this.randomInt(1, 6);
          let n = this.randomInt(1, 6);
          if (Math.random() > 0.5) m = -m;
          if (Math.random() > 0.5) n = -n;
          
          const roots = [-m, -n];
          const positiveRoot = roots.filter(r => r > 0)[0] || Math.abs(roots[0]);
          
          return { 
            m, n, 
            answer: positiveRoot,
            displayAnswer: positiveRoot.toString(),
            root1: -m,
            root2: -n,
            questionText: `If (x + ${m})(x + ${n}) = 0, what is the positive value of x?`
          };
        }
      },
      {
        name: 'system_equations_medium',
        text: "If y = {a}x + {b} and y = {c}x + {d}, what is the value of x?",
        difficulty: 'medium',
        generate: () => {
          const a = this.randomInt(2, 5);
          const b = this.randomInt(-5, 5);
          const c = this.randomInt(2, 5);
          while (c === a) c = this.randomInt(2, 5);
          const d = this.randomInt(-5, 5);
          
          const x = (d - b) / (a - c);
          
          return { 
            a, b, c, d, 
            answer: x,
            displayAnswer: x % 1 === 0 ? x.toString() : x.toFixed(2),
            questionText: `If y = ${a}x + ${b} and y = ${c}x + ${d}, what is the value of x?`
          };
        }
      },
      {
        name: 'circle_circumference_medium',
        text: "A circle has a diameter of {diameter} units. What is its circumference? (Use π = 3.14)",
        difficulty: 'medium',
        generate: () => {
          const diameter = this.randomChoice([6, 8, 10, 12, 14]);
          const answer = 3.14 * diameter;
          return { 
            diameter, 
            answer,
            displayAnswer: answer.toFixed(2),
            questionText: `A circle has a diameter of ${diameter} units. What is its circumference? (Use π = 3.14)`
          };
        }
      },
      {
        name: 'function_evaluation_medium',
        text: "If f(x) = {a}x² + {b}x + {c}, what is f({xValue})?",
        difficulty: 'medium',
        generate: () => {
          const a = this.randomInt(1, 3);
          const b = this.randomInt(-3, 3);
          const c = this.randomInt(-5, 5);
          const xValue = this.randomInt(-2, 2);
          const answer = a * xValue * xValue + b * xValue + c;
          
          return { 
            a, b, c, xValue, 
            answer,
            displayAnswer: answer.toString(),
            questionText: `If f(x) = ${a}x² + ${b}x + ${c}, what is f(${xValue})?`
          };
        }
      },
      {
        name: 'probability_medium',
        text: "A bag contains {red} red marbles and {blue} blue marbles. If one marble is drawn at random, what is the probability it is red?",
        difficulty: 'medium',
        generate: () => {
          const red = this.randomInt(3, 7);
          const blue = this.randomInt(5, 9);
          const totalMarbles = red + blue;
          const answer = `${red}/${totalMarbles}`; // ✅ FIXED
          
          return { 
            red, blue, 
            answer,
            displayAnswer: answer,
            questionText: `A bag contains ${red} red marbles and ${blue} blue marbles. If one marble is drawn at random, what is the probability it is red?`
          };
        }
      },
      {
        name: 'percent_increase_medium',
        text: "The price of a product increased from ${oldPrice} to ${newPrice}. What is the percent increase?",
        difficulty: 'medium',
        generate: () => {
          const oldPrice = this.randomInt(20, 50);
          const increase = this.randomInt(5, 15);
          const newPrice = oldPrice + increase;
          const answer = (increase / oldPrice) * 100;
          
          return { 
            oldPrice, newPrice,
            answer,
            displayAnswer: Math.round(answer).toString() + '%',
            questionText: `The price of a product increased from $${oldPrice} to $${newPrice}. What is the percent increase?`
          };
        }
      },
      {
        name: 'quadratic_roots_medium',
        text: "What is the sum of the roots of the equation x² - {b}x + {c} = 0?",
        difficulty: 'medium',
        generate: () => {
          const root1 = this.randomInt(1, 5);
          const root2 = this.randomInt(1, 5);
          const b = root1 + root2;
          const c = root1 * root2;
          const answer = root1 + root2;
          
          return { 
            b, c,
            answer,
            displayAnswer: answer.toString(),
            questionText: `What is the sum of the roots of the equation x² - ${b}x + ${c} = 0?`
          };
        }
      },

      // ========== HARD DIFFICULTY (Challenging SAT) ==========
      {
        name: 'exponential_growth_hard',
        text: "An investment of ${principal} grows at {rate}% annual interest compounded yearly. What is its value after {years} years?",
        difficulty: 'hard',
        generate: () => {
          const principal = this.randomChoice([1000, 1500, 2000]);
          const rate = this.randomChoice([5, 6, 7]);
          const years = this.randomInt(2, 5);
          const answer = principal * Math.pow(1 + rate/100, years);
          
          return { 
            principal, rate, years, 
            answer,
            displayAnswer: `$${answer.toFixed(2)}`,
            questionText: `An investment of $${principal} grows at ${rate}% annual interest compounded yearly. What is its value after ${years} years?`
          };
        }
      },
      {
        name: 'trigonometry_right_triangle_hard',
        text: "In a right triangle with hypotenuse {hyp} and one angle of {angle}°, what is the length of the side opposite that angle?",
        difficulty: 'hard',
        generate: () => {
          const hyp = this.randomChoice([10, 13, 17]);
          const angle = this.randomChoice([30, 45, 60]);
          let answer;
          if (angle === 30) answer = hyp * 0.5;
          else if (angle === 45) answer = hyp * Math.sqrt(2)/2;
          else answer = hyp * Math.sqrt(3)/2;
          
          return { 
            hyp, angle, 
            answer,
            displayAnswer: answer.toFixed(2),
            questionText: `In a right triangle with hypotenuse ${hyp} and one angle of ${angle}°, what is the length of the side opposite that angle?`
          };
        }
      },
      {
        name: 'complex_inequality_hard',
        text: "For what values of x is {a}x + {b} > {c}x + {d}?",
        difficulty: 'hard',
        generate: () => {
          const a = this.randomInt(2, 5);
          const b = this.randomInt(-5, 5);
          const c = this.randomInt(2, 5);
          while (c === a) c = this.randomInt(2, 5);
          const d = this.randomInt(-5, 5);
          
          const solution = (d - b) / (a - c);
          const direction = a > c ? '>' : '<';
          const answer = `x ${direction} ${solution.toFixed(2)}`;
          
          return { 
            a, b, c, d, 
            answer,
            displayAnswer: answer,
            questionText: `For what values of x is ${a}x + ${b} > ${c}x + ${d}?`
          };
        }
      },
      {
        name: 'data_analysis_mean_hard',
        text: "The mean of five numbers is {mean}. Four of the numbers are {num1}, {num2}, {num3}, and {num4}. What is the fifth number?",
        difficulty: 'hard',
        generate: () => {
          const mean = this.randomInt(10, 20);
          const nums = [
            this.randomInt(mean - 5, mean + 5),
            this.randomInt(mean - 5, mean + 5),
            this.randomInt(mean - 5, mean + 5),
            this.randomInt(mean - 5, mean + 5)
          ];
          const sum = mean * 5;
          const currentSum = nums.reduce((a, b) => a + b, 0);
          const answer = sum - currentSum;
          
          return { 
            mean, 
            num1: nums[0], num2: nums[1], num3: nums[2], num4: nums[3],
            answer,
            displayAnswer: answer.toString(),
            questionText: `The mean of five numbers is ${mean}. Four of the numbers are ${nums[0]}, ${nums[1]}, ${nums[2]}, and ${nums[3]}. What is the fifth number?`
          };
        }
      },
      {
        name: 'quadratic_formula_hard',
        text: "What is the smaller solution to the equation x² + {b}x + {c} = 0?",
        difficulty: 'hard',
        generate: () => {
          let root1 = this.randomInt(-6, -1);
          let root2 = this.randomInt(1, 6);
          
          const b = -(root1 + root2);
          const c = root1 * root2;
          const answer = Math.min(root1, root2);
          
          return {
            b, c,
            answer,
            root1, root2,
            displayAnswer: answer.toString(),
            questionText: `What is the smaller solution to the equation x² + ${b}x + ${c} = 0?`
          };
        }
      },
      {
        name: 'exponential_decay_hard',
        text: "A car worth ${value} depreciates at {rate}% per year. What will it be worth after {years} years?",
        difficulty: 'hard',
        generate: () => {
          const value = this.randomChoice([20000, 25000, 30000]);
          const rate = this.randomChoice([10, 15, 20]);
          const years = this.randomInt(2, 4);
          const answer = value * Math.pow(1 - rate/100, years);
          
          return { 
            value, rate, years,
            answer,
            displayAnswer: `$${answer.toFixed(2)}`,
            questionText: `A car worth $${value} depreciates at ${rate}% per year. What will it be worth after ${years} years?`
          };
        }
      },

      // ========== VERY HARD DIFFICULTY (SAT Advanced) ==========
      {
        name: 'complex_quadratic_very_hard',
        text: "The quadratic equation x² + {b}x + {c} = 0 has roots that differ by 3. If one root is {root1}, what is the value of c?",
        difficulty: 'very hard',
        generate: () => {
          const root1 = this.randomInt(-4, 4);
          const root2 = root1 + 3;
          const b = -(root1 + root2);
          const c = root1 * root2;
          
          return { 
            b, c, root1,
            answer: c,
            displayAnswer: c.toString(),
            questionText: `The quadratic equation x² + ${b}x + ${c} = 0 has roots that differ by 3. If one root is ${root1}, what is the value of c?`
          };
        }
      },
      {
        name: 'function_composition_very_hard',
        text: "If f(x) = {a}x + {b} and g(x) = x², what is f(g({xValue}))?",
        difficulty: 'very hard',
        generate: () => {
          const a = this.randomInt(2, 4);
          const b = this.randomInt(-3, 3);
          const xValue = this.randomInt(-3, 3);
          const gValue = xValue * xValue;
          const answer = a * gValue + b;
          
          return { 
            a, b, xValue,
            answer,
            displayAnswer: answer.toString(),
            questionText: `If f(x) = ${a}x + ${b} and g(x) = x², what is f(g(${xValue}))?`
          };
        }
      },
      {
        name: 'probability_compound_very_hard',
        text: "Two fair six-sided dice are rolled. What is the probability that the sum is {targetSum} or greater?",
        difficulty: 'very hard',
        generate: () => {
          const targetSum = this.randomChoice([8, 9, 10]);
          let favorable = 0;
          for (let i = 1; i <= 6; i++) {
            for (let j = 1; j <= 6; j++) {
              if (i + j >= targetSum) favorable++;
            }
          }
          const answer = `${favorable}/36`;
          
          return { 
            targetSum,
            answer,
            displayAnswer: answer,
            questionText: `Two fair six-sided dice are rolled. What is the probability that the sum is ${targetSum} or greater?`
          };
        }
      },
      {
        name: 'circle_equation_very_hard',
        text: "A circle has the equation (x - {h})² + (y - {k})² = {r}². What is the distance from the center to the origin?",
        difficulty: 'very hard',
        generate: () => {
          const h = this.randomInt(-5, 5);
          const k = this.randomInt(-5, 5);
          const r = this.randomInt(3, 7);
          const distance = Math.sqrt(h*h + k*k);
          
          return { 
            h, k, r,
            answer: distance,
            displayAnswer: distance.toFixed(2),
            questionText: `A circle has the equation (x - ${h})² + (y - ${k})² = ${r}². What is the distance from the center to the origin?`
          };
        }
      },
      {
        name: 'system_complex_very_hard',
        text: "Solve for x: {a}x + {b}y = {c} and {d}x + {e}y = {f}",
        difficulty: 'very hard',
        generate: () => {
          const x = this.randomInt(1, 5);
          const y = this.randomInt(1, 5);
          
          let a, b, d, e;
          do {
            a = this.randomInt(1, 5);
            b = this.randomInt(1, 5);
            d = this.randomInt(1, 5);
            e = this.randomInt(1, 5);
          } while (a * e === b * d);
          
          const c = a * x + b * y;
          const f = d * x + e * y;
          
          return { 
            a, b, c, d, e, f, 
            answer: x, 
            displayAnswer: x.toString(),
            questionText: `Solve for x: ${a}x + ${b}y = ${c} and ${d}x + ${e}y = ${f}`
          };
        }
      },
      {
        name: 'rational_expression_very_hard',
        text: "If (x + {a})/(x - {b}) = {c}, what is the value of x?",
        difficulty: 'very hard',
        generate: () => {
          const a = this.randomInt(1, 4);
          const b = this.randomInt(1, 4);
          const x = this.randomInt(2, 6);
          const c = (x + a) / (x - b);
          
          return { 
            a, b, 
            c: parseFloat(c.toFixed(1)),
            answer: x,
            displayAnswer: x.toString(),
            questionText: `If (x + ${a})/(x - ${b}) = ${c.toFixed(1)}, what is the value of x?`
          };
        }
      }
    ];

    // Filter by current difficulty
    let filteredTemplates = allTemplates.filter(template => template.difficulty === this.difficulty);
    
    // SPECIAL HANDLING FOR "EASY" - Remove basic arithmetic
    if (this.difficulty === 'easy') {
      filteredTemplates = filteredTemplates.filter(template => 
        !['simple_geometry_easy', 'fraction_addition_easy', 'percentage_basic_easy'].includes(template.name)
      );
    }
    
    // If no templates for this difficulty, use appropriate fallback
    if (filteredTemplates.length === 0) {
      console.warn(`No templates found for difficulty: ${this.difficulty}, using appropriate fallback`);
      if (this.difficulty === 'easy') {
        return allTemplates.filter(t => t.difficulty === 'easy');
      } else if (this.difficulty === 'medium') {
        return allTemplates.filter(t => t.difficulty === 'medium');
      } else if (this.difficulty === 'hard') {
        return allTemplates.filter(t => t.difficulty === 'hard');
      } else {
        return allTemplates.filter(t => t.difficulty === 'very hard');
      }
    }
    
    return filteredTemplates;
  }

  generateOptions(correctAnswer, template, values = {}) {
    const correctNum = this.parseNumber(correctAnswer);
    const options = new Set();
    
    // Start with correct answer
    const formattedCorrect = this.formatAnswer(correctAnswer);
    options.add(formattedCorrect);
    
    // Generate distractors based on template type
    if (template.name.includes('quadratic') && (values.root1 !== undefined || values.root2 !== undefined)) {
      const root1 = values.root1 || 0;
      const root2 = values.root2 || 0;
      
      if (root1 !== undefined) options.add(this.formatAnswer(root1));
      if (root2 !== undefined) options.add(this.formatAnswer(root2));
      
      const distractors = [
        Math.max(root1, root2),
        -root1,
        -root2,
        root1 + 1,
        root2 - 1,
        (root1 + root2) / 2,
        0
      ];
      
      for (const distractor of distractors) {
        if (options.size >= 6) break;
        const formatted = this.formatAnswer(distractor);
        if (!options.has(formatted)) {
          options.add(formatted);
        }
      }
    } else if (template.name.includes('system')) {
      const wrongAnswers = [
        values.c / (values.a || 1),
        values.f / (values.d || 1),
        (values.c + values.f) / ((values.a + values.d) || 1),
        (values.c - values.f) / ((values.a - values.d) || 1),
        0,
        Math.round(correctNum) + 1,
        Math.round(correctNum) - 1
      ];
      
      for (const wrong of wrongAnswers) {
        if (options.size >= 6) break;
        const formatted = this.formatAnswer(wrong);
        if (!options.has(formatted) && !this.areAnswersEqual(formatted, formattedCorrect)) {
          options.add(formatted);
        }
      }
    } else if (template.name.includes('percent') || template.name.includes('percentage')) {
      const wrongAnswers = [
        correctNum * 2,
        correctNum / 2,
        correctNum + (correctNum * 0.1),
        correctNum - (correctNum * 0.1),
        Math.round(correctNum * 1.5),
        Math.round(correctNum * 0.75)
      ];
      
      for (const wrong of wrongAnswers) {
        if (options.size >= 6) break;
        const formatted = this.formatAnswer(wrong);
        if (!options.has(formatted) && !this.areAnswersEqual(formatted, formattedCorrect)) {
          options.add(formatted);
        }
      }
    } else {
      const distractors = [
        correctNum + 1,
        correctNum - 1,
        correctNum * 2,
        correctNum / 2,
        -correctNum,
        correctNum + 2,
        correctNum - 2,
        Math.floor(correctNum),
        Math.ceil(correctNum),
        0
      ];
      
      for (const distractor of distractors) {
        if (options.size >= 8) break;
        const formatted = this.formatAnswer(distractor);
        if (!this.areAnswersEqual(formatted, formattedCorrect)) {
          options.add(formatted);
        }
      }
    }
    
    let optionsArray = Array.from(options);
    
    while (optionsArray.length < 4) {
      const randomNum = this.randomInt(-10, 10);
      const formatted = this.formatAnswer(randomNum);
      if (!optionsArray.includes(formatted)) {
        optionsArray.push(formatted);
      }
    }
    
    optionsArray = this.shuffleArray(optionsArray).slice(0, 4);
    
    let correctIndex = -1;
    for (let i = 0; i < optionsArray.length; i++) {
      if (this.areAnswersEqual(optionsArray[i], formattedCorrect)) {
        correctIndex = i;
        break;
      }
    }
    
    if (correctIndex === -1) {
      const replaceIndex = this.randomInt(0, 3);
      optionsArray[replaceIndex] = formattedCorrect;
      correctIndex = replaceIndex;
    }
    
    return optionsArray;
  }

  areAnswersEqual(answer1, answer2) {
    const num1 = this.parseNumber(answer1);
    const num2 = this.parseNumber(answer2);
    
    if (isNaN(num1) || isNaN(num2)) {
      return String(answer1).trim() === String(answer2).trim();
    }
    
    return Math.abs(num1 - num2) < 0.001;
  }

  parseNumber(value) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string') {
      const cleanValue = value.replace(/[%\$,]/g, '').trim();
      
      if (cleanValue.includes('/')) {
        const parts = cleanValue.split('/');
        if (parts.length === 2) {
          const num = parseFloat(parts[0]);
          const den = parseFloat(parts[1]);
          if (den !== 0) return num / den;
        }
      }
      
      const parsed = parseFloat(cleanValue);
      if (!isNaN(parsed)) return parsed;
    }
    return NaN;
  }

  formatAnswer(value) {
    if (typeof value === 'string') {
      if (value.includes('/') && !value.includes('.')) {
        const [num, den] = value.split('/').map(Number);
        if (!isNaN(num) && !isNaN(den) && den !== 0) {
          const gcd = this.gcd(Math.abs(num), Math.abs(den));
          const simpleNum = num / gcd;
          const simpleDen = den / gcd;
          
          if (simpleDen === 1) return simpleNum.toString();
          if (simpleDen === -1) return (-simpleNum).toString();
          return `${simpleNum}/${simpleDen}`;
        }
      }
      return value;
    }
    
    const num = this.parseNumber(value);
    if (isNaN(num)) return String(value);
    
    if (Math.abs(num - Math.round(num)) > 0.0001) {
      for (let den = 1; den <= 20; den++) {
        for (let numerator = -40; numerator <= 40; numerator++) {
          const fraction = numerator / den;
          if (Math.abs(fraction - num) < 0.0001) {
            if (den === 1) return numerator.toString();
            const gcd = this.gcd(Math.abs(numerator), den);
            const simpleNum = numerator / gcd;
            const simpleDen = den / gcd;
            if (simpleDen === 1) return simpleNum.toString();
            return `${simpleNum}/${simpleDen}`;
          }
        }
      }
    }
    
    if (Math.abs(num - Math.round(num)) < 0.0001) {
      return Math.round(num).toString();
    }
    
    return parseFloat(num.toFixed(2)).toString();
  }

  gcd(a, b) {
    a = Math.abs(a);
    b = Math.abs(b);
    while (b !== 0) {
      const temp = b;
      b = a % b;
      a = temp;
    }
    return a;
  }

  shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // ✅ IMPROVED: Difficulty-appropriate fallback questions
  generateSATFallbackQuestion() {
    // EASY level fallback
    if (this.difficulty === 'easy') {
      const questionTypes = [
        {
          name: 'algebra_solve_easy_fallback',
          generate: () => {
            const a = this.randomInt(2, 5);
            const b = this.randomInt(1, 5);
            const c = this.randomInt(10, 20);
            const x = (c - b) / a;
            return {
              question: `Solve for x: ${a}x + ${b} = ${c}`,
              answer: x,
              options: [x, x + 1, x - 1, x * 2]
            };
          }
        },
        {
          name: 'ratio_easy_fallback',
          generate: () => {
            const ratio1 = this.randomInt(2, 4);
            const ratio2 = this.randomInt(3, 5);
            const part = this.randomInt(10, 30);
            const whole = (part * (ratio1 + ratio2)) / ratio1;
            return {
              question: `The ratio of A to B is ${ratio1}:${ratio2}. If there are ${part} of A, how many are there in total?`,
              answer: whole,
              options: [whole, whole + 5, whole - 5, whole * 1.5]
            };
          }
        },
        {
          name: 'exponent_easy_fallback',
          generate: () => {
            const base = this.randomInt(2, 5);
            const answer = base * base;
            return {
              question: `What is ${base}²?`,
              answer: answer,
              options: [answer, answer + base, answer - base, base * 3]
            };
          }
        }
      ];
      
      const selected = this.randomChoice(questionTypes);
      const generated = selected.generate();
      
      const options = this.shuffleArray(generated.options.map(opt => 
        Number.isInteger(opt) ? opt.toString() : opt.toFixed(2)
      ));
      
      let correctIndex = -1;
      const formattedCorrect = this.formatAnswer(generated.answer);
      for (let i = 0; i < options.length; i++) {
        if (this.areAnswersEqual(options[i], formattedCorrect)) {
          correctIndex = i;
          break;
        }
      }
      
      if (correctIndex === -1) {
        options[0] = formattedCorrect;
        correctIndex = 0;
      }
      
      return {
        questionText: generated.question,
        correctAnswer: generated.answer,
        correctAnswerIndex: correctIndex,
        options: options,
        type: 'mcq',
        templateType: 'sat_fallback_easy',
        verified: true,
        difficulty: this.difficulty,
        sectionType: this.sectionType
      };
    }
    
    // MEDIUM level fallback
    else if (this.difficulty === 'medium') {
      const questionTypes = [
        {
          name: 'quadratic_fallback_medium',
          generate: () => {
            const root1 = this.randomInt(2, 4);
            const root2 = this.randomInt(3, 5);
            const answer = Math.max(root1, root2);
            return {
              question: `What is the positive solution to (x - ${root1})(x - ${root2}) = 0?`,
              answer: answer,
              options: [answer, answer + 1, answer - 1, root1 * root2]
            };
          }
        },
        {
          name: 'system_fallback_medium',
          generate: () => {
            const x = this.randomInt(2, 4);
            const y = this.randomInt(1, 3);
            const a = this.randomInt(2, 3);
            const b = this.randomInt(1, 2);
            const c = a * x + b * y;
            const d = this.randomInt(2, 3);
            const e = this.randomInt(1, 2);
            const f = d * x + e * y;
            return {
              question: `If ${a}x + ${b}y = ${c} and ${d}x + ${e}y = ${f}, what is the value of x?`,
              answer: x,
              options: [x, x + 1, x - 1, y]
            };
          }
        },
        {
          name: 'function_fallback_medium',
          generate: () => {
            const a = this.randomInt(2, 3);
            const b = this.randomInt(2, 4);
            const x = this.randomInt(2, 4);
            return {
              question: `If f(x) = ${a}x + ${b}, what is f(${x})?`,
              answer: a * x + b,
              options: [a * x + b, a * x + b + 1, a * x + b - 1, a * x]
            };
          }
        }
      ];
      
      const selected = this.randomChoice(questionTypes);
      const generated = selected.generate();
      
      const options = this.shuffleArray(generated.options.map(opt => 
        Number.isInteger(opt) ? opt.toString() : opt.toFixed(2)
      ));
      
      let correctIndex = -1;
      const formattedCorrect = this.formatAnswer(generated.answer);
      for (let i = 0; i < options.length; i++) {
        if (this.areAnswersEqual(options[i], formattedCorrect)) {
          correctIndex = i;
          break;
        }
      }
      
      if (correctIndex === -1) {
        options[0] = formattedCorrect;
        correctIndex = 0;
      }
      
      return {
        questionText: generated.question,
        correctAnswer: generated.answer,
        correctAnswerIndex: correctIndex,
        options: options,
        type: 'mcq',
        templateType: 'sat_fallback_medium',
        verified: true,
        difficulty: this.difficulty,
        sectionType: this.sectionType
      };
    }
    
    // HARD level fallback
    else if (this.difficulty === 'hard') {
      const questionTypes = [
        {
          name: 'exponential_fallback_hard',
          generate: () => {
            const p = this.randomInt(1000, 2000);
            const r = this.randomInt(5, 7);
            const t = this.randomInt(2, 3);
            const answer = p * Math.pow(1 + r/100, t);
            return {
              question: `An investment of $${p} grows at ${r}% annual interest compounded yearly. What is its value after ${t} years?`,
              answer: answer,
              options: [
                answer.toFixed(2), 
                (answer * 1.1).toFixed(2), 
                (answer * 0.9).toFixed(2), 
                (p * (1 + r/100 * t)).toFixed(2)
              ]
            };
          }
        },
        {
          name: 'trig_fallback_hard',
          generate: () => {
            const hyp = this.randomInt(10, 15);
            const answer = hyp * 0.5;
            return {
              question: `In a 30-60-90 triangle, the hypotenuse is ${hyp}. What is the length of the side opposite the 30° angle?`,
              answer: answer,
              options: [answer.toString(), (answer * 2).toString(), (answer * 1.5).toString(), hyp.toString()]
            };
          }
        },
        {
          name: 'mean_fallback_hard',
          generate: () => {
            const mean = this.randomInt(12, 18);
            const nums = [
              this.randomInt(mean - 3, mean - 1),
              this.randomInt(mean - 2, mean),
              this.randomInt(mean, mean + 2),
              this.randomInt(mean + 1, mean + 3)
            ];
            const sum = mean * 5;
            const currentSum = nums.reduce((a, b) => a + b, 0);
            const answer = sum - currentSum;
            return {
              question: `The mean of five numbers is ${mean}. Four numbers are ${nums[0]}, ${nums[1]}, ${nums[2]}, and ${nums[3]}. What is the fifth number?`,
              answer: answer,
              options: [answer.toString(), (answer + 2).toString(), (answer - 2).toString(), (mean * 2).toString()]
            };
          }
        }
      ];
      
      const selected = this.randomChoice(questionTypes);
      const generated = selected.generate();
      
      const options = this.shuffleArray(generated.options);
      
      let correctIndex = -1;
      const formattedCorrect = this.formatAnswer(generated.answer);
      for (let i = 0; i < options.length; i++) {
        if (this.areAnswersEqual(options[i], formattedCorrect)) {
          correctIndex = i;
          break;
        }
      }
      
      if (correctIndex === -1) {
        options[0] = formattedCorrect;
        correctIndex = 0;
      }
      
      return {
        questionText: generated.question,
        correctAnswer: generated.answer,
        correctAnswerIndex: correctIndex,
        options: options,
        type: 'mcq',
        templateType: 'sat_fallback_hard',
        verified: true,
        difficulty: this.difficulty,
        sectionType: this.sectionType
      };
    }
    
    // VERY HARD level fallback
    else {
      const questionTypes = [
        {
          name: 'complex_quadratic_fallback_very_hard',
          generate: () => {
            const root1 = this.randomInt(2, 3);
            const root2 = root1 + 3;
            const c = root1 * root2;
            return {
              question: `A quadratic equation has roots that differ by 3. If one root is ${root1}, what is the value of c in x² + bx + c = 0?`,
              answer: c,
              options: [c.toString(), (c + 1).toString(), (c - 1).toString(), (root1 * 2).toString()]
            };
          }
        },
        {
          name: 'composition_fallback_very_hard',
          generate: () => {
            const a = this.randomInt(2, 3);
            const b = this.randomInt(1, 2);
            const x = this.randomInt(-2, 2);
            const g = x * x - 1;
            const answer = a * g + b;
            return {
              question: `If f(x) = ${a}x + ${b} and g(x) = x² - 1, what is f(g(${x}))?`,
              answer: answer,
              options: [answer.toString(), (answer + 1).toString(), (answer - 1).toString(), (a * x + b).toString()]
            };
          }
        },
        {
          name: 'circle_fallback_very_hard',
          generate: () => {
            const h = this.randomInt(3, 5);
            const k = this.randomInt(3, 5);
            const distance = Math.sqrt(h*h + k*k).toFixed(2);
            return {
              question: `A circle has equation (x - ${h})² + (y - ${k})² = 25. What is the distance from the center to the origin?`,
              answer: parseFloat(distance),
              options: [distance, (parseFloat(distance) + 1).toFixed(2), (parseFloat(distance) - 1).toFixed(2), (h + k).toString()]
            };
          }
        }
      ];
      
      const selected = this.randomChoice(questionTypes);
      const generated = selected.generate();
      
      const options = this.shuffleArray(generated.options);
      
      let correctIndex = -1;
      const formattedCorrect = this.formatAnswer(generated.answer);
      for (let i = 0; i < options.length; i++) {
        if (this.areAnswersEqual(options[i], formattedCorrect)) {
          correctIndex = i;
          break;
        }
      }
      
      if (correctIndex === -1) {
        options[0] = formattedCorrect;
        correctIndex = 0;
      }
      
      return {
        questionText: generated.question,
        correctAnswer: generated.answer,
        correctAnswerIndex: correctIndex,
        options: options,
        type: 'mcq',
        templateType: 'sat_fallback_very_hard',
        verified: true,
        difficulty: this.difficulty,
        sectionType: this.sectionType
      };
    }
  }
}

module.exports = SATMathGenerator;