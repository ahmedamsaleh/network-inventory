var express             = require("express"),
    passport            = require("passport"),
    LocalStrategy       = require("passport-local");
var User                = require("../models/user");
var ValidatedUser       = require("../models/validatedUser");
var nodemailer = require('nodemailer'); 
var smtpConfig = {
    host: '<HOST>',
    port: 25,
    secure: false, // upgrade later with STARTTLS
    auth: {
        user: '<USER>@<DOMAIN>',
        pass: '<yourpassword>'
    }
};
var transporter = nodemailer.createTransport(smtpConfig);

var mailOptions = {
  from: '<SENDER>@<DOMAIN>',
  to: '<RECIPIENT>@<DOMAIN>',
  subject: 'Activate your Network Inventory account'
};

var router              = express.Router();
//add routes
router.get("/home",function(request, response) {
    response.render("home");
});
router.get("/",function(request, response) {
    response.render("landing");
});
//PASS environment parameters
router.get("/getenv", function(req, res){
    res.json({ ip: process.env.IP, port: process.env.PORT });
});
//======================
// AUTH ROUTES
//======================
//show register Form
router.get("/signup",function(request,response){
    response.render("signup");
});
//handle signup logic
router.post("/signup",function(request,response){
    var newUser =new User({name: request.body.name, email: request.body.email});
    ValidatedUser.findOne({email: request.body.email},function(error,foundUser){
        if(error){
            request.flash("error",error);
            return response.render("signup");
        }
        else if(foundUser == null){
            request.flash("error","User not allowed");
            return response.render("email-error");
        }
        else{
            User.register(newUser,request.body.password,function(error,user){
                if(error){
                    request.flash("error",error.message);
                    return response.render("signup");
                }
                else{
                        //send email verification
                        var authenticationURL = "http://"+process.env.IP+":"+process.env.PORT+"/verify?authToken=" + user.authToken;
                        mailOptions.text = "Hi, you have signed for access to Network Inventory, please activate it by clicking on the following URL:\n"+authenticationURL;
                        transporter.sendMail(mailOptions, function(error, info){
                          if (error) {
                            console.log(error);
                          } 
                        }); 
                        response.redirect('/email-verification');
                }
            });    
        }
    });
});

router.get('/email-verification', function(request, response) {
    response.render('email-verification', {title: 'Email verification sent!'})
});

router.get('/verify', function(request, response) {
    User.verifyEmail(request.query.authToken, function(error, existingAuthToken) {
        if(error){
            console.log('error:', error);
        }
        else{
            response.render('email-verification', { title : 'Email verified succesfully!' });
        }
    });
});

//show login form
router.get("/login",function(request,response){
    response.render("login");
});

// handling login logic
router.post("/login",passport.authenticate('local',{
    successRedirect: "/home",
    failureRedirect: "/login"
}));

//logout ROUTE
router.get("/logout",function(request,response){
    request.logout();
    request.flash("success","logged you out");
    response.redirect("/login");
});

//show change password form
router.get("/changepass",function(request,response){
    response.render("changepassword");
});

router.post('/changepass' , function (request, res, next) {
     if (request.body.newpass !== request.body.newpassconfirm) {
        throw new Error('password and confirm password do not match');
     }

     var useremail = request.body.email;

     var newpass = request.body.newpass;

User.findOne({email: useremail},function(error,foundUser){
    if(error) {console.log(error);}
    else{
        foundUser.email = user;
        foundUser=newpass
        user.save(function(err){
         if (err) { next(err) }
         else {
             res.redirect('/home');
         }
     });

    }

});
     user.save(function(err){
         if (err) { next(err) }
         else {
             res.redirect('/home');
         }
     });
});

//middleware
function isLoggedIn(request,response,next){
    if(request.isAuthenticated()){
        return next();
    }
    request.flash("error", "You need to be logged in to do that");
    response.redirect("/login");
}

module.exports = router;